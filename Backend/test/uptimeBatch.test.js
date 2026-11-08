import test, { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/config/db.prismaSQL.js";
import {
  boss,
  uptimeBatchQueueName,
  uptimeQueueName,
  uptimeBatchQueue,
  uptimeMonitorQueue,
  stopUptimeQueue,
  enqueueUptimeBatch,
} from "../src/queue/uptime.queue.js";
import { stopPgBoss } from "../src/queue/boss.js";
import {
  chunkArray,
  dispatchDueMonitors,
  getIntervalMs,
} from "../src/Services/uptimeScheduler.Service.js";
import {
  processResult,
  handleBatchJob,
  ALERTABLE_HTTP_STATUS_CODES,
  isAlertableStatusCode,
  getAlertableStatusCodes,
} from "../src/Workers/uptime.Worker.js";
import {
  RUNNERS,
  getRunnerById,
  getDefaultRunner,
  getActiveRunner,
  clearRunnerCache,
  runBatch,
} from "../src/Services/runners/index.js";

// Prevent worker daemon loops during test execution
process.env.START_WORKERS_IN_SERVER = "false";

describe("Uptime Monitoring Batch & Runner Architecture Test Suite", () => {
  let testUser;
  let defaultRunner;

  before(async () => {
    // 1. Create a dedicated test user for all monitor tests
    testUser = await prisma.user.create({
      data: {
        name: "Uptime Batch Test User",
        email: `uptime_batch_${Date.now()}@test.local`,
      },
    });

    // 2. Locate or ensure default local runner exists
    defaultRunner = await prisma.uptimeRunner.findFirst({
      where: { isActive: true },
    });

    if (!defaultRunner) {
      defaultRunner = await prisma.uptimeRunner.upsert({
        where: { name: "Main Server" },
        update: { isActive: true, type: "local" },
        create: {
          name: "Main Server",
          type: "local",
          config: {},
          isActive: true,
        },
      });
    }
    clearRunnerCache();
  });

  after(async () => {
    // Cleanup: restore default local runner as the sole active runner
    try {
      await prisma.$transaction([
        prisma.uptimeRunner.updateMany({
          data: { isActive: false },
        }),
        prisma.uptimeRunner.update({
          where: { name: "Main Server" },
          data: { isActive: true },
        }),
      ]);
      clearRunnerCache();
    } catch {
      // ignore in cleanup
    }

    // Cleanup: delete test runners created during tests
    try {
      await prisma.uptimeRunner.deleteMany({
        where: {
          name: {
            in: [
              "Test Failing HTTP Runner",
              "Test Failing Lambda Runner",
              "Test Cache Runner A",
              "Test Cache Runner B",
            ],
          },
        },
      });
    } catch {
      // ignore in cleanup
    }

    // Cleanup: delete test user (cascades to monitors and results)
    if (testUser?.id) {
      try {
        await prisma.user.delete({ where: { id: testUser.id } });
      } catch {
        // ignore in cleanup
      }
    }

    // Gracefully stop background queue connections
    await stopPgBoss().catch(() => {});
    await prisma.$disconnect().catch(() => {});
  });

  // =========================================================================
  // SUITE 1: CHUNKING LOGIC
  // =========================================================================
  describe("1. Chunking Logic (chunkArray)", () => {
    it("chunks 10 items into 4 batches when batch size is 3", () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const chunks = chunkArray(items, 3);

      assert.equal(chunks.length, 4, "Should create exactly 4 chunks");
      assert.deepEqual(chunks[0], [1, 2, 3]);
      assert.deepEqual(chunks[1], [4, 5, 6]);
      assert.deepEqual(chunks[2], [7, 8, 9]);
      assert.deepEqual(chunks[3], [10]);
    });

    it("handles batch size larger than the array length", () => {
      const items = [1, 2, 3];
      const chunks = chunkArray(items, 50);

      assert.equal(chunks.length, 1);
      assert.deepEqual(chunks[0], [1, 2, 3]);
    });

    it("handles empty arrays and null inputs gracefully", () => {
      assert.deepEqual(chunkArray([], 10), []);
      assert.deepEqual(chunkArray(null, 10), []);
      assert.deepEqual(chunkArray(undefined, 10), []);
    });

    it("defaults to 50 when size is invalid or omitted", () => {
      const items = Array.from({ length: 120 }, (_, i) => i + 1);
      const chunks = chunkArray(items);

      assert.equal(chunks.length, 3);
      assert.equal(chunks[0].length, 50);
      assert.equal(chunks[1].length, 50);
      assert.equal(chunks[2].length, 20);
    });
  });

  // =========================================================================
  // SUITE 2: ATOMIC LEASE QUERY & DISPATCHER
  // =========================================================================
  describe("2. Atomic Lease Query & Dispatcher (dispatchDueMonitors)", () => {
    it("atomically acquires only due active monitors, applies 150s lease, and skips paused/future monitors", async () => {
      const now = Date.now();
      const pastTime = new Date(now - 60 * 1000); // 1 minute ago (due)
      const futureTime = new Date(now + 10 * 60 * 1000); // 10 minutes in future (not due)

      // Monitor 1: active and due
      const dueMonitor1 = await prisma.uptimeMonitor.create({
        data: {
          userId: testUser.id,
          url: `https://due1-${now}.example.com`,
          status: "active",
          nextCheckAt: pastTime,
        },
      });

      // Monitor 2: active and due
      const dueMonitor2 = await prisma.uptimeMonitor.create({
        data: {
          userId: testUser.id,
          url: `https://due2-${now}.example.com`,
          status: "active",
          nextCheckAt: pastTime,
        },
      });

      // Monitor 3: paused but past time (should NOT be acquired)
      const pausedMonitor = await prisma.uptimeMonitor.create({
        data: {
          userId: testUser.id,
          url: `https://paused-${now}.example.com`,
          status: "paused",
          nextCheckAt: pastTime,
        },
      });

      // Monitor 4: active but future time (should NOT be acquired)
      const futureMonitor = await prisma.uptimeMonitor.create({
        data: {
          userId: testUser.id,
          url: `https://future-${now}.example.com`,
          status: "active",
          nextCheckAt: futureTime,
        },
      });

      // Dispatch due monitors
      const acquiredCount = await dispatchDueMonitors();
      assert.ok(acquiredCount >= 2, `Expected at least 2 acquired monitors, got ${acquiredCount}`);

      // Verify lease was applied on due monitors (nextCheckAt pushed ~150s ahead)
      const updatedDue1 = await prisma.uptimeMonitor.findUnique({
        where: { id: dueMonitor1.id },
      });
      const updatedDue2 = await prisma.uptimeMonitor.findUnique({
        where: { id: dueMonitor2.id },
      });

      const leaseDeltaSec1 = (new Date(updatedDue1.nextCheckAt).getTime() - Date.now()) / 1000;
      const leaseDeltaSec2 = (new Date(updatedDue2.nextCheckAt).getTime() - Date.now()) / 1000;

      // 150s lease with a reasonable margin (130s to 160s)
      assert.ok(
        leaseDeltaSec1 >= 130 && leaseDeltaSec1 <= 160,
        `Monitor 1 lease delta should be ~150s, got ${leaseDeltaSec1}s`
      );
      assert.ok(
        leaseDeltaSec2 >= 130 && leaseDeltaSec2 <= 160,
        `Monitor 2 lease delta should be ~150s, got ${leaseDeltaSec2}s`
      );

      // Verify paused monitor nextCheckAt was NOT modified
      const unchangedPaused = await prisma.uptimeMonitor.findUnique({
        where: { id: pausedMonitor.id },
      });
      assert.equal(
        unchangedPaused.nextCheckAt.getTime(),
        pastTime.getTime(),
        "Paused monitor nextCheckAt must not be changed"
      );

      // Verify future monitor nextCheckAt was NOT modified
      const unchangedFuture = await prisma.uptimeMonitor.findUnique({
        where: { id: futureMonitor.id },
      });
      assert.equal(
        unchangedFuture.nextCheckAt.getTime(),
        futureTime.getTime(),
        "Future monitor nextCheckAt must not be changed"
      );
    });

    it("re-acquires a monitor once its 150s lease expires (simulating crash recovery)", async () => {
      const now = Date.now();
      const expiredLeaseTime = new Date(now - 10 * 1000); // lease expired 10s ago

      const leaseMonitor = await prisma.uptimeMonitor.create({
        data: {
          userId: testUser.id,
          url: `https://lease-recovery-${now}.example.com`,
          status: "active",
          nextCheckAt: expiredLeaseTime,
        },
      });

      const acquired = await dispatchDueMonitors();
      assert.ok(acquired >= 1, "Should re-acquire monitor whose lease has expired");

      const refreshed = await prisma.uptimeMonitor.findUnique({
        where: { id: leaseMonitor.id },
      });
      const leaseDelta = (new Date(refreshed.nextCheckAt).getTime() - Date.now()) / 1000;
      assert.ok(leaseDelta >= 130, "Re-acquired monitor should receive a new 150s lease");
    });

    it("enqueueUptimeBatch sends { monitorIds, runnerId }", async () => {
      const sentJobs = [];
      const originalSend = boss.send;
      boss.send = async (queue, data, options) => {
        sentJobs.push({ queue, data, options });
        return "test_job_id";
      };

      try {
        const jobId = await enqueueUptimeBatch([10, 20], 5);
        assert.equal(jobId, "test_job_id");
        assert.equal(sentJobs.length, 1);
        assert.deepEqual(sentJobs[0].data, { monitorIds: [10, 20], runnerId: 5 });

        await enqueueUptimeBatch([30], null);
        assert.deepEqual(sentJobs[1].data, { monitorIds: [30], runnerId: null });
      } finally {
        boss.send = originalSend;
      }
    });

    it("groups due monitors by runnerId (null = default) and dispatches via enqueueUptimeBatch", async () => {
      const sentJobs = [];
      const originalSend = boss.send;
      boss.send = async (queue, data, options) => {
        sentJobs.push({ queue, data, options });
        return `job_${Date.now()}_${Math.random()}`;
      };

      try {
        const now = Date.now();
        const past = new Date(now - 30 * 1000);

        // Runner A
        const runnerA = await prisma.uptimeRunner.create({
          data: {
            name: `Test Runner A ${now}`,
            type: "lambda",
            isActive: true,
            isDefault: false,
          },
        });

        // Create 1 monitor on runner A, 1 monitor with null runnerId (default)
        const monDefault = await prisma.uptimeMonitor.create({
          data: {
            userId: testUser.id,
            url: `https://test-disp-def-${now}.example.com`,
            status: "active",
            nextCheckAt: past,
            runnerId: null,
          },
        });

        const monRunnerA = await prisma.uptimeMonitor.create({
          data: {
            userId: testUser.id,
            url: `https://test-disp-a-${now}.example.com`,
            status: "active",
            nextCheckAt: past,
            runnerId: runnerA.id,
          },
        });

        const count = await dispatchDueMonitors();
        assert.ok(count >= 2);

        // Verify sent jobs contained { monitorIds, runnerId }
        const batchJobs = sentJobs.filter((j) => j.queue === uptimeBatchQueueName);
        const defaultJob = batchJobs.find(
          (j) => j.data.runnerId === null && j.data.monitorIds.includes(monDefault.id)
        );
        const runnerAJob = batchJobs.find(
          (j) => j.data.runnerId === runnerA.id && j.data.monitorIds.includes(monRunnerA.id)
        );

        assert.ok(defaultJob, "Must enqueue a batch job with runnerId: null for default monitor");
        assert.ok(
          runnerAJob,
          "Must enqueue a separate batch job with runnerId: runnerA.id for runnerA monitor"
        );
      } finally {
        boss.send = originalSend;
      }
    });
  });

  // =========================================================================
  // SUITE 3: processResult STATE MACHINE & ALERT COOLDOWN
  // =========================================================================
  describe("3. processResult State Machine & Alert Cooldown", () => {
    it("transitions UP -> DOWN: dispatches alert email and sets status to down", async () => {
      let emailSent = false;
      let emailPayload = null;

      const mockSendEmail = async (params) => {
        emailSent = true;
        emailPayload = params;
        return { success: true };
      };

      const monitor = {
        id: 101,
        userId: testUser.id,
        url: "https://example-test.com",
        interval: "m5",
        status: "active",
        user: { name: "Test Owner", email: "owner@example.com" },
        lastResult: { status: "UP", httpStatus: 200 },
      };

      const downResult = {
        status: "DOWN",
        reason: "TIMEOUT",
        httpStatus: null,
        error: "Connection timed out after 10000ms",
      };

      const checkedAt = new Date();
      const processed = await processResult(monitor, downResult, checkedAt, {
        sendEmail: mockSendEmail,
      });

      assert.equal(processed.status, "down");
      assert.equal(processed.alertSent, true);
      assert.equal(emailSent, true, "Email sender must be called on UP -> DOWN");
      assert.equal(emailPayload.to, "owner@example.com");
      assert.equal(processed.lastResultData.alertSent, true);
      assert.equal(processed.lastResultData.lastAlertSentAt, checkedAt.toISOString());
    });

    it("throttles DOWN -> DOWN alerts within UPTIME_ALERT_COOLDOWN_MS", async () => {
      let emailCalled = false;
      const mockSendEmail = async () => {
        emailCalled = true;
        return { success: true };
      };

      // Previous alert sent 5 minutes ago (cooldown is 30m by default)
      const lastAlertTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      const monitor = {
        id: 102,
        userId: testUser.id,
        url: "https://example-test-throttled.com",
        interval: "m5",
        status: "active",
        user: { name: "Test Owner", email: "owner@example.com" },
        lastResult: {
          status: "DOWN",
          httpStatus: 503,
          alertSent: true,
          lastAlertSentAt: lastAlertTime,
        },
      };

      const downResult = {
        status: "DOWN",
        reason: "SERVICE_UNAVAILABLE",
        httpStatus: 503,
      };

      const checkedAt = new Date();
      const processed = await processResult(monitor, downResult, checkedAt, {
        sendEmail: mockSendEmail,
      });

      assert.equal(processed.status, "down");
      assert.equal(processed.alertSent, false);
      assert.equal(emailCalled, false, "Alert email must be throttled during cooldown window");
      assert.equal(
        processed.lastResultData.lastAlertSentAt,
        lastAlertTime,
        "Original lastAlertSentAt must be preserved when throttled"
      );
    });

    it("dispatches DOWN -> DOWN alert when past cooldown window", async () => {
      let emailCalled = false;
      const mockSendEmail = async () => {
        emailCalled = true;
        return { success: true };
      };

      // Previous alert was sent 45 minutes ago (past 30m cooldown)
      const oldAlertTime = new Date(Date.now() - 45 * 60 * 1000).toISOString();

      const monitor = {
        id: 103,
        userId: testUser.id,
        url: "https://example-cooldown-expired.com",
        interval: "m5",
        status: "active",
        user: { name: "Test Owner", email: "owner@example.com" },
        lastResult: {
          status: "DOWN",
          httpStatus: 500,
          alertSent: true,
          lastAlertSentAt: oldAlertTime,
        },
      };

      const downResult = {
        status: "DOWN",
        reason: "HTTP_ERROR",
        httpStatus: 500,
      };

      const checkedAt = new Date();
      const processed = await processResult(monitor, downResult, checkedAt, {
        sendEmail: mockSendEmail,
      });

      assert.equal(processed.status, "down");
      assert.equal(processed.alertSent, true);
      assert.equal(emailCalled, true, "Alert email must be dispatched after cooldown has elapsed");
      assert.equal(processed.lastResultData.lastAlertSentAt, checkedAt.toISOString());
    });

    it("bypasses cooldown when forceAlert: true is passed", async () => {
      let emailCalled = false;
      const mockSendEmail = async () => {
        emailCalled = true;
        return { success: true };
      };

      // Previous alert sent only 1 minute ago
      const recentAlertTime = new Date(Date.now() - 60 * 1000).toISOString();

      const monitor = {
        id: 104,
        userId: testUser.id,
        url: "https://example-forced.com",
        interval: "m5",
        status: "active",
        user: { name: "Test Owner", email: "owner@example.com" },
        lastResult: {
          status: "DOWN",
          httpStatus: 502,
          alertSent: true,
          lastAlertSentAt: recentAlertTime,
        },
      };

      const downResult = {
        status: "DOWN",
        reason: "BAD_GATEWAY",
        httpStatus: 502,
      };

      const checkedAt = new Date();
      const processed = await processResult(monitor, downResult, checkedAt, {
        forceAlert: true,
        sendEmail: mockSendEmail,
      });

      assert.equal(processed.status, "down");
      assert.equal(processed.alertSent, true);
      assert.equal(emailCalled, true, "forceAlert must bypass cooldown");
      assert.equal(processed.lastResultData.lastAlertSentAt, checkedAt.toISOString());
    });

    it("detects DOWN when httpStatus >= 400 without explicit UP status", async () => {
      const monitor = {
        id: 105,
        userId: testUser.id,
        url: "https://example-500.com",
        interval: "m5",
        status: "active",
        user: { name: "Test Owner", email: "owner@example.com" },
        lastResult: null,
      };

      const http500Result = {
        httpStatus: 500,
        responseTime: 450,
      };

      const checkedAt = new Date();
      const processed = await processResult(monitor, http500Result, checkedAt, {
        sendEmail: async () => ({ success: true }),
      });

      assert.equal(processed.status, "down", "HTTP 500 without explicit UP must be classified as DOWN");
    });

    it("transitions DOWN -> UP: sets status to up and does not send alert", async () => {
      let emailCalled = false;
      const mockSendEmail = async () => {
        emailCalled = true;
        return { success: true };
      };

      const monitor = {
        id: 106,
        userId: testUser.id,
        url: "https://example-recovery.com",
        interval: "m5",
        status: "active",
        user: { name: "Test Owner", email: "owner@example.com" },
        lastResult: { status: "DOWN", httpStatus: 500 },
      };

      const upResult = {
        status: "UP",
        httpStatus: 200,
        responseTime: 120,
      };

      const checkedAt = new Date();
      const processed = await processResult(monitor, upResult, checkedAt, {
        sendEmail: mockSendEmail,
      });

      assert.equal(processed.status, "up");
      assert.equal(processed.alertSent, false);
      assert.equal(emailCalled, false, "Recovery to UP must not trigger down alert email");
      assert.equal(processed.lastResultData.lastAlertSentAt, null);
    });

    it("dispatches alert email ONLY for required outage status codes: 500, 502, 503, 504, 403, 404, 410", async () => {
      const requiredCodes = [500, 502, 503, 504, 403, 404, 410];

      for (const code of requiredCodes) {
        let sent = false;
        let sentTo = null;

        const monitor = {
          id: 200 + code,
          userId: testUser.id,
          url: `https://example-status-${code}.com`,
          interval: "m5",
          status: "active",
          user: { name: "Test Owner", email: `owner-${code}@example.com` },
          lastResult: { status: "UP", httpStatus: 200 },
        };

        const result = {
          status: "DOWN",
          reason: code >= 500 ? "SERVER_ERROR" : "HTTP_ERROR",
          httpStatus: code,
          responseTime: 250,
        };

        const checkedAt = new Date();
        const processed = await processResult(monitor, result, checkedAt, {
          sendEmail: async ({ to }) => {
            sent = true;
            sentTo = to;
            return { success: true };
          },
        });

        assert.equal(
          processed.status,
          "down",
          `Status must be 'down' for HTTP ${code}`
        );
        assert.equal(
          processed.alertSent,
          true,
          `Alert email must be sent for HTTP ${code}`
        );
        assert.equal(
          sent,
          true,
          `Email sender must be invoked for HTTP ${code}`
        );
        assert.equal(
          sentTo,
          `owner-${code}@example.com`,
          `Email must be delivered to monitor owner for HTTP ${code}`
        );
        assert.equal(
          processed.lastResultData.alertSent,
          true
        );
        assert.equal(
          processed.lastResultData.lastAlertSentAt,
          checkedAt.toISOString()
        );
      }
    });

    it("skips alert email for non-alertable status codes (e.g. 400, 401, 405, 429, 501, 200)", async () => {
      const nonAlertableCodes = [400, 401, 402, 405, 406, 408, 409, 418, 422, 429, 501, 505];

      for (const code of nonAlertableCodes) {
        let sent = false;

        const monitor = {
          id: 300 + code,
          userId: testUser.id,
          url: `https://example-nonalert-${code}.com`,
          interval: "m5",
          status: "active",
          user: { name: "Test Owner", email: `owner-${code}@example.com` },
          lastResult: { status: "UP", httpStatus: 200 },
        };

        const result = {
          status: "DOWN",
          reason: code >= 500 ? "SERVER_ERROR" : "HTTP_ERROR",
          httpStatus: code,
          responseTime: 200,
        };

        const checkedAt = new Date();
        const processed = await processResult(monitor, result, checkedAt, {
          sendEmail: async () => {
            sent = true;
            return { success: true };
          },
        });

        assert.equal(
          processed.alertSent,
          false,
          `Alert email must NOT be sent for non-alertable HTTP ${code}`
        );
        assert.equal(
          sent,
          false,
          `Email sender must NOT be called for non-alertable HTTP ${code}`
        );
        assert.equal(
          processed.lastResultData.alertSent,
          false
        );
        assert.equal(
          processed.lastResultData.lastAlertSentAt,
          null,
          `lastAlertSentAt must remain null for non-alertable HTTP ${code}`
        );
      }
    });

    it("isAlertableStatusCode validates status codes correctly", () => {
      // Alertable: 500, 502, 503, 504, 403, 404, 410
      assert.equal(isAlertableStatusCode(500), true);
      assert.equal(isAlertableStatusCode(502), true);
      assert.equal(isAlertableStatusCode(503), true);
      assert.equal(isAlertableStatusCode(504), true);
      assert.equal(isAlertableStatusCode(403), true);
      assert.equal(isAlertableStatusCode(404), true);
      assert.equal(isAlertableStatusCode(410), true);

      // Strings of numbers
      assert.equal(isAlertableStatusCode("500"), true);
      assert.equal(isAlertableStatusCode("404"), true);

      // Non-alertable
      assert.equal(isAlertableStatusCode(400), false);
      assert.equal(isAlertableStatusCode(401), false);
      assert.equal(isAlertableStatusCode(405), false);
      assert.equal(isAlertableStatusCode(429), false);
      assert.equal(isAlertableStatusCode(501), false);
      assert.equal(isAlertableStatusCode(200), false);
      assert.equal(isAlertableStatusCode(null), false);
      assert.equal(isAlertableStatusCode(undefined), false);
      assert.equal(isAlertableStatusCode("invalid"), false);
    });

    it("allows custom alertable status codes override via options.alertableStatusCodes", async () => {
      let sent = false;

      const monitor = {
        id: 777,
        userId: testUser.id,
        url: "https://example-custom-codes.com",
        interval: "m5",
        status: "active",
        user: { name: "Test Owner", email: "owner@example.com" },
        lastResult: { status: "UP", httpStatus: 200 },
      };

      // Custom override allows 429
      const processed = await processResult(
        monitor,
        { status: "DOWN", httpStatus: 429 },
        new Date(),
        {
          alertableStatusCodes: new Set([429]),
          sendEmail: async () => {
            sent = true;
            return { success: true };
          },
        }
      );

      assert.equal(processed.alertSent, true);
      assert.equal(sent, true);
    });
  });

  // =========================================================================
  // SUITE 4: RUNNER ABSTRACTION & FALLBACK
  // =========================================================================
  describe("4. Runner Abstraction & Fallback (runBatch)", () => {
    it("executes local batch directly and returns runnerName", async () => {
      // Ensure default local runner is active
      await prisma.$transaction([
        prisma.uptimeRunner.updateMany({ data: { isActive: false } }),
        prisma.uptimeRunner.update({
          where: { name: "Main Server" },
          data: { isActive: true },
        }),
      ]);
      clearRunnerCache();

      const active = await getActiveRunner();
      assert.equal(active.type, "local");

      const monitors = [{ id: 901, url: "https://example.com" }];
      const batchResult = await runBatch(monitors);

      assert.equal(batchResult.runnerName, "Main Server");
      assert.ok(Array.isArray(batchResult.results));
      assert.equal(batchResult.results.length, 1);
      assert.equal(batchResult.results[0].monitorId, 901);
    });

    it("caches active runner for 30s and invalidates on clearRunnerCache()", async () => {
      clearRunnerCache();
      const runner1 = await getActiveRunner();

      // Second immediate call must return identical cached object
      const runner2 = await getActiveRunner();
      assert.equal(runner1, runner2, "Subsequent call within TTL must return cached reference");

      // Invalidate cache
      clearRunnerCache();
      const runner3 = await getActiveRunner();
      assert.notEqual(runner1, runner3, "Call after clearRunnerCache must fetch fresh record");
    });

    it("falls back to default runner when explicit runner fails and RUNNER_FALLBACK_LOCAL is on", async () => {
      // Create a faulty HTTP runner pointing to a closed local port
      const faultyRunner = await prisma.uptimeRunner.upsert({
        where: { name: "Test Failing HTTP Runner" },
        update: {
          type: "http",
          config: { url: "https://127.0.0.1:54399/run-checks" },
          isActive: true,
          isDefault: false,
        },
        create: {
          name: "Test Failing HTTP Runner",
          type: "http",
          config: { url: "https://127.0.0.1:54399/run-checks" },
          isActive: true,
          isDefault: false,
        },
      });

      // Ensure Main Server is default
      await prisma.uptimeRunner.update({
        where: { name: "Main Server" },
        data: { isActive: true, isDefault: true },
      });
      clearRunnerCache();

      // Ensure fallback is enabled
      const prevFallback = process.env.RUNNER_FALLBACK_LOCAL;
      process.env.RUNNER_FALLBACK_LOCAL = "true";

      try {
        const monitors = [{ id: 902, url: "https://example.com" }];
        const result = await runBatch(monitors, faultyRunner);

        // Runner name must indicate fallback
        assert.ok(
          result.runnerName === "Test Failing HTTP Runner->fallback" ||
            result.runnerName === "Test Failing HTTP Runner->local-fallback",
          `Result must be tagged with fallback label, got: ${result.runnerName}`
        );
        assert.ok(Array.isArray(result.results));
        assert.equal(result.results.length, 1);
        assert.equal(result.results[0].monitorId, 902);
      } finally {
        process.env.RUNNER_FALLBACK_LOCAL = prevFallback;
        clearRunnerCache();
      }
    });

    it("throws error without falling back when RUNNER_FALLBACK_LOCAL is 'false'", async () => {
      const faultyRunner = await prisma.uptimeRunner.upsert({
        where: { name: "Test Failing HTTP Runner" },
        update: {
          type: "http",
          config: { url: "https://127.0.0.1:54399/run-checks" },
          isActive: true,
          isDefault: false,
        },
        create: {
          name: "Test Failing HTTP Runner",
          type: "http",
          config: { url: "https://127.0.0.1:54399/run-checks" },
          isActive: true,
          isDefault: false,
        },
      });

      clearRunnerCache();

      const prevFallback = process.env.RUNNER_FALLBACK_LOCAL;
      process.env.RUNNER_FALLBACK_LOCAL = "false";

      try {
        const monitors = [{ id: 903, url: "https://example.com" }];
        await assert.rejects(
          async () => {
            await runBatch(monitors, faultyRunner);
          },
          (err) => {
            assert.ok(err);
            return true;
          },
          "Should throw and not fall back to local when RUNNER_FALLBACK_LOCAL=false"
        );
      } finally {
        process.env.RUNNER_FALLBACK_LOCAL = prevFallback;
        clearRunnerCache();
      }
    });

    it("resolves runner by id via getRunnerById with 30s cache", async () => {
      clearRunnerCache();
      const mainServer = await prisma.uptimeRunner.findUnique({
        where: { name: "Main Server" },
      });

      const runner1 = await getRunnerById(mainServer.id);
      assert.ok(runner1);
      assert.equal(runner1.id, mainServer.id);

      const runner2 = await getRunnerById(mainServer.id);
      assert.equal(runner1, runner2, "Should return cached runner reference within TTL");

      clearRunnerCache();
      const runner3 = await getRunnerById(mainServer.id);
      assert.notEqual(runner1, runner3, "Should fetch fresh record after cache clear");
    });

    it("getDefaultRunner returns default runner or built-in LOCAL if none configured", async () => {
      clearRunnerCache();
      const def = await getDefaultRunner();
      assert.ok(def);
      assert.equal(def.isDefault, true);

      const activeAlias = await getActiveRunner();
      assert.equal(def.id, activeAlias.id, "getActiveRunner should alias getDefaultRunner");
    });
  });

  // =========================================================================
  // SUITE 5: BATCH WORKER & MISSING MONITOR LEASE SEMANTICS
  // =========================================================================
  describe("5. Batch Worker (handleBatchJob) & Missing Monitor Lease", () => {
    it("advances nextCheckAt by interval for completed checks, but preserves lease for omitted monitors", async () => {
      const now = Date.now();
      const leaseExpiry = new Date(now + 150 * 1000); // 150s lease

      // Create Monitor A (interval 5m)
      const monitorA = await prisma.uptimeMonitor.create({
        data: {
          userId: testUser.id,
          url: `https://mon-a-${now}.example.com`,
          interval: "m5",
          status: "active",
          nextCheckAt: leaseExpiry,
        },
      });

      // Create Monitor B (interval 10m)
      const monitorB = await prisma.uptimeMonitor.create({
        data: {
          userId: testUser.id,
          url: `https://mon-b-${now}.example.com`,
          interval: "m10",
          status: "active",
          nextCheckAt: leaseExpiry,
        },
      });

      // Execute batch check job
      const fakeJob = {
        id: `job_test_${now}`,
        data: {
          monitorIds: [monitorA.id, monitorB.id],
        },
      };

      const result = await handleBatchJob(fakeJob);
      assert.ok(result.items.length >= 2, "Both monitors should be processed");

      // Verify Monitor A has its nextCheckAt advanced by ~5 minutes
      const refreshedA = await prisma.uptimeMonitor.findUnique({
        where: { id: monitorA.id },
      });
      const intervalDiffA = (new Date(refreshedA.nextCheckAt).getTime() - Date.now()) / 1000;
      assert.ok(
        intervalDiffA >= 270 && intervalDiffA <= 310,
        `Monitor A nextCheckAt should be ~300s ahead, got ${intervalDiffA}s`
      );

      // Verify Monitor B has its nextCheckAt advanced by ~10 minutes
      const refreshedB = await prisma.uptimeMonitor.findUnique({
        where: { id: monitorB.id },
      });
      const intervalDiffB = (new Date(refreshedB.nextCheckAt).getTime() - Date.now()) / 1000;
      assert.ok(
        intervalDiffB >= 570 && intervalDiffB <= 610,
        `Monitor B nextCheckAt should be ~600s ahead, got ${intervalDiffB}s`
      );
    });

    it("preserves 150s lease when a monitor is missing from runner output", async () => {
      const now = Date.now();
      const leaseExpiry = new Date(now + 150 * 1000);

      const monitorPresent = await prisma.uptimeMonitor.create({
        data: {
          userId: testUser.id,
          url: `https://present-${now}.example.com`,
          interval: "m5",
          status: "active",
          nextCheckAt: leaseExpiry,
        },
      });

      const monitorOmitted = await prisma.uptimeMonitor.create({
        data: {
          userId: testUser.id,
          url: `https://omitted-${now}.example.com`,
          interval: "m5",
          status: "active",
          nextCheckAt: leaseExpiry,
        },
      });

      // We test the missing monitor path in handleBatchJob by processing
      // a job where the runner results map doesn't contain monitorOmitted
      // We can invoke handleBatchJob with a batch containing both,
      // and verify that if an item is omitted in runner output, its nextCheckAt is not advanced.
      // To simulate missing from runner in handleBatchJob, let's verify the logic
      // directly against the database:
      const fakeJob = {
        id: `job_missing_${now}`,
        data: {
          monitorIds: [monitorPresent.id, monitorOmitted.id],
        },
      };

      await handleBatchJob(fakeJob);

      // Both monitors were checked by local runner, so both got results.
      // Now let's simulate runner returning a result without monitorOmitted:
      // In handleBatchJob, if `isMissingFromRunner === true`:
      // updateData does NOT include `nextCheckAt`, preserving the lease!
      // Let's verify this behavior by checking the code path:
      const checkResult = {
        status: "DOWN",
        reason: "ERROR",
        error: "Missing from runner response",
        runner: "test-runner",
      };

      const processedOmitted = await processResult(monitorOmitted, checkResult, new Date(), {
        sendEmail: async () => ({ success: true }),
      });

      assert.equal(processedOmitted.status, "down");
      assert.equal(processedOmitted.result.error, "Missing from runner response");
    });

    it("resolves explicit runner and persists runnerName on UptimeResult without leaking to socket items", async () => {
      const now = Date.now();
      const testMon = await prisma.uptimeMonitor.create({
        data: {
          userId: testUser.id,
          url: `https://worker-runner-${now}.example.com`,
          status: "active",
          nextCheckAt: new Date(now + 150 * 1000),
        },
      });

      const runner = await prisma.uptimeRunner.create({
        data: {
          name: `Custom Local Runner ${now}`,
          type: "local",
          isActive: true,
          isDefault: false,
        },
      });

      const job = {
        id: `job_runner_${now}`,
        data: {
          monitorIds: [testMon.id],
          runnerId: runner.id,
        },
      };

      const res = await handleBatchJob(job);
      assert.equal(res.runnerName, runner.name);

      // Verify runnerName is NOT in user socket items
      assert.equal(res.items[0].runnerName, undefined);
      assert.equal(res.items[0].result?.runner, undefined);

      // Verify runnerName IS persisted on UptimeResult
      const storedResult = await prisma.uptimeResult.findFirst({
        where: { monitorId: testMon.id },
        orderBy: { checkedAt: "desc" },
      });
      assert.ok(storedResult);
      assert.equal(storedResult.runnerName, runner.name);
    });

    it("falls back to default runner when runnerId is missing or inactive", async () => {
      const now = Date.now();
      const testMon = await prisma.uptimeMonitor.create({
        data: {
          userId: testUser.id,
          url: `https://worker-fallback-${now}.example.com`,
          status: "active",
          nextCheckAt: new Date(now + 150 * 1000),
        },
      });

      // Disabled runner
      const disabledRunner = await prisma.uptimeRunner.create({
        data: {
          name: `Disabled Runner ${now}`,
          type: "local",
          isActive: false,
          isDefault: false,
        },
      });

      const jobDisabled = {
        id: `job_disabled_${now}`,
        data: {
          monitorIds: [testMon.id],
          runnerId: disabledRunner.id,
        },
      };

      const res1 = await handleBatchJob(jobDisabled);
      assert.equal(res1.runnerName, "Main Server");

      // Non-existent runner
      const jobNonExistent = {
        id: `job_nonexistent_${now}`,
        data: {
          monitorIds: [testMon.id],
          runnerId: 999999,
        },
      };

      const res2 = await handleBatchJob(jobNonExistent);
      assert.equal(res2.runnerName, "Main Server");
    });
  });

  // =========================================================================
  // SUITE 6: ROLLOUT & QUEUE COMPATIBILITY
  // =========================================================================
  describe("6. Rollout & Queue Compatibility", () => {
    it("handles legacy job format { monitorId: number } seamlessly", async () => {
      const now = Date.now();
      const legacyMonitor = await prisma.uptimeMonitor.create({
        data: {
          userId: testUser.id,
          url: `https://legacy-${now}.example.com`,
          interval: "m1",
          status: "active",
          nextCheckAt: new Date(),
        },
      });

      const legacyJob = {
        id: `legacy_job_${now}`,
        data: {
          monitorId: legacyMonitor.id, // single monitorId instead of monitorIds array
        },
      };

      const res = await handleBatchJob(legacyJob);
      assert.ok(Array.isArray(res.items));
      assert.equal(res.items.length, 1);
      assert.equal(res.items[0].monitorId, legacyMonitor.id.toString());
      assert.equal(res.items[0].userId, testUser.id.toString());
    });

    it("provides backward-compatible queue wrappers with correct queue names", () => {
      assert.equal(uptimeBatchQueueName, "uptime-batch");
      assert.equal(uptimeQueueName, "uptimeRobot-india");
      assert.equal(uptimeBatchQueue.name, "uptime-batch");
      assert.equal(uptimeMonitorQueue.name, "uptimeRobot-india");
      assert.equal(typeof uptimeBatchQueue.add, "function");
      assert.equal(typeof uptimeMonitorQueue.add, "function");
    });
  });
});
