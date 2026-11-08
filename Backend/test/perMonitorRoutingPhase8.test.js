import test, { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { prisma } from "../src/config/db.prismaSQL.js";
import { ROLES } from "../src/Middleware/authentication.Mw.js";
import {
  boss,
  uptimeBatchQueueName,
  enqueueUptimeBatch,
} from "../src/queue/uptime.queue.js";
import { stopPgBoss } from "../src/queue/boss.js";
import { dispatchDueMonitors } from "../src/Services/uptimeScheduler.Service.js";
import { handleBatchJob } from "../src/Workers/uptime.Worker.js";
import {
  RUNNERS,
  getRunnerById,
  getDefaultRunner,
  getActiveRunner,
  clearRunnerCache,
  runBatch,
} from "../src/Services/runners/index.js";

// Prevent worker daemon background loops during test execution
process.env.START_WORKERS_IN_SERVER = "false";

describe("Phase 8: Comprehensive Per-Monitor Runner Routing End-to-End Suite", () => {
  let app;
  let server;
  let baseUrl;
  let adminUser;
  let regularUser;
  let adminSid;
  let regularSid;
  let defaultLocalRunner;

  before(async () => {
    const serverModule = await import("../src/server.js");
    app = serverModule.app;

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    const timestamp = Date.now();

    // 1. Admin user & session
    adminUser = await prisma.user.create({
      data: {
        name: "Phase 8 Admin",
        email: `admin_phase8_${timestamp}@test.local`,
        role: ROLES.ADMIN,
      },
    });
    const adminSession = await prisma.session.create({
      data: { userId: adminUser.id },
    });
    adminSid = adminSession.id;

    // 2. Regular user & session
    regularUser = await prisma.user.create({
      data: {
        name: "Phase 8 Regular User",
        email: `user_phase8_${timestamp}@test.local`,
        role: ROLES.USER,
      },
    });
    const regularSession = await prisma.session.create({
      data: { userId: regularUser.id },
    });
    regularSid = regularSession.id;

    // 3. Ensure a valid default local runner exists
    defaultLocalRunner = await prisma.uptimeRunner.upsert({
      where: { name: "Main Server" },
      update: { type: "local", isActive: true, isDefault: true },
      create: { name: "Main Server", type: "local", isActive: true, isDefault: true },
    });
    clearRunnerCache();
  });

  after(async () => {
    // Restore Main Server as default
    try {
      await prisma.uptimeRunner.updateMany({ data: { isDefault: false } });
      await prisma.uptimeRunner.update({
        where: { name: "Main Server" },
        data: { isActive: true, isDefault: true },
      });
      clearRunnerCache();
    } catch {}

    // Cleanup test users (cascades monitors and results)
    try {
      if (adminUser?.id) await prisma.user.delete({ where: { id: adminUser.id } }).catch(() => {});
      if (regularUser?.id) await prisma.user.delete({ where: { id: regularUser.id } }).catch(() => {});
    } catch {}

    // Cleanup any extra test runners
    try {
      await prisma.uptimeRunner.deleteMany({
        where: {
          name: {
            contains: "Phase8",
          },
        },
      });
    } catch {}

    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    await prisma.$disconnect();
    try {
      await stopPgBoss();
    } catch {}
  });

  const adminHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminSid}`,
  });

  const regularHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${regularSid}`,
  });

  // =========================================================================
  // CRITERION 1: Dispatcher groups monitors by runnerId into separate jobs
  // =========================================================================
  it("Criterion 1: Dispatcher groups monitors by runnerId into separate jobs", async () => {
    const timestamp = Date.now();
    const past = new Date(timestamp - 30 * 1000);

    const runnerAlpha = await prisma.uptimeRunner.create({
      data: {
        name: `Phase8 Group Alpha ${timestamp}`,
        type: "local",
        isActive: true,
        isDefault: false,
      },
    });

    const runnerBeta = await prisma.uptimeRunner.create({
      data: {
        name: `Phase8 Group Beta ${timestamp}`,
        type: "local",
        isActive: true,
        isDefault: false,
      },
    });

    const monA = await prisma.uptimeMonitor.create({
      data: {
        userId: adminUser.id,
        url: `https://mon-a-${timestamp}.example.com`,
        status: "active",
        nextCheckAt: past,
        runnerId: runnerAlpha.id,
      },
    });

    const monB = await prisma.uptimeMonitor.create({
      data: {
        userId: adminUser.id,
        url: `https://mon-b-${timestamp}.example.com`,
        status: "active",
        nextCheckAt: past,
        runnerId: runnerBeta.id,
      },
    });

    const monNull = await prisma.uptimeMonitor.create({
      data: {
        userId: adminUser.id,
        url: `https://mon-null-${timestamp}.example.com`,
        status: "active",
        nextCheckAt: past,
        runnerId: null,
      },
    });

    const sentJobs = [];
    const origSend = boss.send;
    boss.send = async (queue, data, opts) => {
      sentJobs.push({ queue, data, opts });
      return `job_${Date.now()}_${Math.random()}`;
    };

    try {
      const dispatchedCount = await dispatchDueMonitors();
      assert.ok(dispatchedCount >= 3, "Dispatcher must claim at least the 3 due monitors");

      const batchJobs = sentJobs.filter((j) => j.queue === uptimeBatchQueueName);

      const jobAlpha = batchJobs.find((j) => j.data.runnerId === runnerAlpha.id);
      const jobBeta = batchJobs.find((j) => j.data.runnerId === runnerBeta.id);
      const jobDefault = batchJobs.find((j) => j.data.runnerId === null && j.data.monitorIds.includes(monNull.id));

      assert.ok(jobAlpha, "Must enqueue a job with runnerId matching runnerAlpha");
      assert.ok(jobBeta, "Must enqueue a job with runnerId matching runnerBeta");
      assert.ok(jobDefault, "Must enqueue a job with runnerId: null for unassigned monitors");

      assert.ok(jobAlpha.data.monitorIds.includes(monA.id), "Alpha job contains Alpha monitor");
      assert.ok(!jobAlpha.data.monitorIds.includes(monB.id), "Alpha job does not contain Beta monitor");
      assert.ok(jobBeta.data.monitorIds.includes(monB.id), "Beta job contains Beta monitor");
      assert.ok(!jobBeta.data.monitorIds.includes(monA.id), "Beta job does not contain Alpha monitor");
    } finally {
      boss.send = origSend;
    }
  });

  // =========================================================================
  // CRITERION 2: NULL runnerId monitors go to the default runner
  // =========================================================================
  it("Criterion 2: NULL runnerId monitors go to the default runner", async () => {
    const timestamp = Date.now();
    const mon = await prisma.uptimeMonitor.create({
      data: {
        userId: adminUser.id,
        url: `${baseUrl}/probe-crit2-${timestamp}`,
        status: "active",
        runnerId: null,
      },
    });

    const job = {
      data: {
        monitorIds: [mon.id],
        runnerId: null,
      },
    };

    await handleBatchJob(job);

    const result = await prisma.uptimeResult.findFirst({
      where: { monitorId: mon.id },
      orderBy: { id: "desc" },
    });

    const defaultRunner = await getDefaultRunner();
    assert.ok(result, "UptimeResult must be stored");
    assert.equal(
      result.runnerName,
      defaultRunner.name,
      "NULL runnerId job must execute under default runner and record its runnerName"
    );
  });

  // =========================================================================
  // CRITERION 3: Worker resolves an explicit runner via getRunnerById
  // =========================================================================
  it("Criterion 3: Worker resolves an explicit runner via getRunnerById", async () => {
    const timestamp = Date.now();
    const explicitRunner = await prisma.uptimeRunner.create({
      data: {
        name: `Phase8 Explicit Runner ${timestamp}`,
        type: "local",
        isActive: true,
        isDefault: false,
      },
    });
    clearRunnerCache();

    // Verify getRunnerById returns it
    const resolved = await getRunnerById(explicitRunner.id);
    assert.equal(resolved?.id, explicitRunner.id);

    const mon = await prisma.uptimeMonitor.create({
      data: {
        userId: adminUser.id,
        url: `${baseUrl}/probe-crit3-${timestamp}`,
        status: "active",
        runnerId: explicitRunner.id,
      },
    });

    const job = {
      data: {
        monitorIds: [mon.id],
        runnerId: explicitRunner.id,
      },
    };

    await handleBatchJob(job);

    const result = await prisma.uptimeResult.findFirst({
      where: { monitorId: mon.id },
      orderBy: { id: "desc" },
    });

    assert.ok(result);
    assert.equal(
      result.runnerName,
      explicitRunner.name,
      "Worker must execute under explicit runner name"
    );
  });

  // =========================================================================
  // CRITERION 4: Worker falls back to default when runner is disabled or deleted
  // =========================================================================
  it("Criterion 4: Worker falls back to default when runner is disabled or deleted", async () => {
    const timestamp = Date.now();
    const defaultRunner = await getDefaultRunner();

    // 4A: Disabled runner
    const disabledRunner = await prisma.uptimeRunner.create({
      data: {
        name: `Phase8 Disabled Runner ${timestamp}`,
        type: "local",
        isActive: false, // DISABLED
        isDefault: false,
      },
    });
    clearRunnerCache();

    const monDisabled = await prisma.uptimeMonitor.create({
      data: {
        userId: adminUser.id,
        url: `${baseUrl}/probe-crit4a-${timestamp}`,
        status: "active",
        runnerId: disabledRunner.id,
      },
    });

    await handleBatchJob({
      data: {
        monitorIds: [monDisabled.id],
        runnerId: disabledRunner.id,
      },
    });

    const resDisabled = await prisma.uptimeResult.findFirst({
      where: { monitorId: monDisabled.id },
      orderBy: { id: "desc" },
    });
    assert.ok(resDisabled);
    assert.equal(
      resDisabled.runnerName,
      defaultRunner.name,
      "Disabled runner must fall back to default runner"
    );

    // 4B: Deleted / non-existent runner
    const monDeleted = await prisma.uptimeMonitor.create({
      data: {
        userId: adminUser.id,
        url: `${baseUrl}/probe-crit4b-${timestamp}`,
        status: "active",
        runnerId: null,
      },
    });

    await handleBatchJob({
      data: {
        monitorIds: [monDeleted.id],
        runnerId: 9999999, // non-existent
      },
    });

    const resDeleted = await prisma.uptimeResult.findFirst({
      where: { monitorId: monDeleted.id },
      orderBy: { id: "desc" },
    });
    assert.ok(resDeleted);
    assert.equal(
      resDeleted.runnerName,
      defaultRunner.name,
      "Non-existent runner ID must fall back to default runner"
    );
  });

  // =========================================================================
  // CRITERION 5: Legacy job without runnerId still works
  // =========================================================================
  it("Criterion 5: Legacy job without runnerId still works", async () => {
    const timestamp = Date.now();
    const defaultRunner = await getDefaultRunner();
    const mon = await prisma.uptimeMonitor.create({
      data: {
        userId: adminUser.id,
        url: `${baseUrl}/probe-crit5-${timestamp}`,
        status: "active",
      },
    });

    // Old queued job payload: only monitorIds, no runnerId property
    const legacyJob = {
      data: {
        monitorIds: [mon.id],
      },
    };

    await handleBatchJob(legacyJob);

    const res = await prisma.uptimeResult.findFirst({
      where: { monitorId: mon.id },
      orderBy: { id: "desc" },
    });

    assert.ok(res, "Legacy job must execute and produce result");
    assert.equal(res.runnerName, defaultRunner.name, "Legacy job routes to default runner");
  });

  // =========================================================================
  // CRITERION 6: runBatch with an explicit runner uses the correct engine
  // =========================================================================
  it("Criterion 6: runBatch with an explicit runner uses the correct engine", async () => {
    const timestamp = Date.now();
    let engineInvoked = false;
    const testRunnerType = `test_engine_${timestamp}`;

    RUNNERS[testRunnerType] = async (monitors, config) => {
      engineInvoked = true;
      return monitors.map((m) => ({
        monitorId: m.id,
        result: {
          url: m.url,
          status: "UP",
          httpStatus: 200,
          responseTime: 42,
          engineTest: true,
        },
      }));
    };

    try {
      const customRunner = {
        id: 77777,
        name: "Test Custom Engine Runner",
        type: testRunnerType,
        config: {},
        isActive: true,
        isDefault: false,
      };

      const out = await runBatch([{ id: 101, url: "https://example.com" }], customRunner);

      assert.equal(engineInvoked, true, "Explicit runner type engine must be executed");
      assert.equal(out.runnerName, "Test Custom Engine Runner");
      assert.equal(out.results.length, 1);
      assert.equal(out.results[0].result.engineTest, true);
    } finally {
      delete RUNNERS[testRunnerType];
    }
  });

  // =========================================================================
  // CRITERION 7: Runner failure: retry, then fall back to default; logged and tagged
  // =========================================================================
  it("Criterion 7: Runner failure: retry, then fall back to default; logged and tagged", async () => {
    const timestamp = Date.now();
    let attempts = 0;
    const failingType = `failing_type_${timestamp}`;

    RUNNERS[failingType] = async () => {
      attempts++;
      throw new Error("Simulated remote network timeout");
    };

    try {
      const failingRunner = {
        id: 88888,
        name: "Remote VPS East",
        type: failingType,
        config: {},
        isActive: true,
        isDefault: false,
      };

      const out = await runBatch([{ id: 202, url: "https://example.com" }], failingRunner);

      // Verify retry occurred (initial attempt + 1 retry = 2 attempts)
      assert.equal(attempts, 2, "Failing runner must be retried exactly once");

      // Verify fallback to default runner took place
      assert.equal(
        out.runnerName,
        "Remote VPS East->fallback",
        "Result must be tagged with '<runnerName>->fallback'"
      );
      assert.ok(out.results.length > 0, "Fallback runner must return results");
      assert.ok(out.results[0].result, "Results must contain valid check data");
    } finally {
      delete RUNNERS[failingType];
    }
  });

  // =========================================================================
  // CRITERION 8: set-default leaves exactly one default
  // =========================================================================
  it("Criterion 8: set-default leaves exactly one default (enforced in API and Postgres partial index)", async () => {
    const timestamp = Date.now();

    const runner1 = await prisma.uptimeRunner.create({
      data: {
        name: `Phase8 Def1 ${timestamp}`,
        type: "local",
        isActive: true,
        isDefault: false,
      },
    });

    const runner2 = await prisma.uptimeRunner.create({
      data: {
        name: `Phase8 Def2 ${timestamp}`,
        type: "local",
        isActive: true,
        isDefault: false,
      },
    });

    // Switch default to runner1 via API
    const res1 = await fetch(`${baseUrl}/admin/runners/${runner1.id}/default`, {
      method: "PUT",
      headers: adminHeaders(),
    });
    assert.equal(res1.status, 200);

    let defaults = await prisma.uptimeRunner.findMany({ where: { isDefault: true } });
    assert.equal(defaults.length, 1, "Exactly 1 default runner must exist");
    assert.equal(defaults[0].id, runner1.id);

    // Switch default to runner2 via API
    const res2 = await fetch(`${baseUrl}/admin/runners/${runner2.id}/default`, {
      method: "PUT",
      headers: adminHeaders(),
    });
    assert.equal(res2.status, 200);

    defaults = await prisma.uptimeRunner.findMany({ where: { isDefault: true } });
    assert.equal(defaults.length, 1, "Exactly 1 default runner must exist after second switch");
    assert.equal(defaults[0].id, runner2.id);

    // Verify Postgres partial unique index directly:
    // Attempting to set another runner isDefault = true via raw SQL MUST violate unique constraint
    await assert.rejects(
      async () => {
        await prisma.$executeRawUnsafe(
          `UPDATE "UptimeRunner" SET "isDefault" = true WHERE id = ${runner1.id}`
        );
      },
      /unique|duplicate key/i,
      "Database partial unique index must reject having two default runners"
    );
  });

  // =========================================================================
  // CRITERION 9: Cannot disable or delete the default runner
  // =========================================================================
  it("Criterion 9: Cannot disable or delete the default runner", async () => {
    const defaultRunner = await getDefaultRunner();

    // 1. Try to toggle (disable) default runner
    const toggleRes = await fetch(`${baseUrl}/admin/runners/${defaultRunner.id}/toggle`, {
      method: "PUT",
      headers: adminHeaders(),
    });
    assert.equal(toggleRes.status, 400);
    const toggleBody = await toggleRes.json();
    assert.match(toggleBody.error, /Cannot disable the default runner/i);

    // 2. Try to delete default runner
    const delRes = await fetch(`${baseUrl}/admin/runners/${defaultRunner.id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    assert.equal(delRes.status, 400);
    const delBody = await delRes.json();
    assert.match(delBody.error, /Cannot delete the default runner/i);
  });

  // =========================================================================
  // CRITERION 10: bulk-runner & move-monitors update right monitors bidirectionally
  // =========================================================================
  it("Criterion 10: bulk-runner and move-monitors update the right monitors bidirectionally (Local<->Lambda)", async () => {
    const timestamp = Date.now();

    const localRunner = await prisma.uptimeRunner.create({
      data: {
        name: `Phase8 Local ${timestamp}`,
        type: "local",
        isActive: true,
        isDefault: false,
      },
    });

    const lambdaRunner = await prisma.uptimeRunner.create({
      data: {
        name: `Phase8 Lambda ${timestamp}`,
        type: "lambda",
        isActive: true,
        isDefault: false,
      },
    });

    const m1 = await prisma.uptimeMonitor.create({
      data: { userId: adminUser.id, url: `https://m1-${timestamp}.com`, status: "active", interval: "m1", runnerId: localRunner.id },
    });
    const m2 = await prisma.uptimeMonitor.create({
      data: { userId: adminUser.id, url: `https://m2-${timestamp}.com`, status: "active", interval: "m1", runnerId: localRunner.id },
    });
    const m3 = await prisma.uptimeMonitor.create({
      data: { userId: adminUser.id, url: `https://m3-${timestamp}.com`, status: "active", interval: "m15", runnerId: localRunner.id },
    });

    // 10A: Bulk-runner Local -> Lambda
    const bulk1 = await fetch(`${baseUrl}/admin/monitors/bulk-runner`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        monitorIds: [m1.id, m2.id],
        runnerId: lambdaRunner.id,
      }),
    });
    assert.equal(bulk1.status, 200);

    let check1 = await prisma.uptimeMonitor.findUnique({ where: { id: m1.id } });
    assert.equal(check1.runnerId, lambdaRunner.id);

    // 10B: Bulk-runner Lambda -> Local (null)
    const bulk2 = await fetch(`${baseUrl}/admin/monitors/bulk-runner`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        monitorIds: [m1.id],
        runnerId: null,
      }),
    });
    assert.equal(bulk2.status, 200);
    check1 = await prisma.uptimeMonitor.findUnique({ where: { id: m1.id } });
    assert.equal(check1.runnerId, null);

    // 10C: Move-monitors Local -> Lambda with filter (interval: '1m')
    // Put both m1 and m2 back on localRunner
    await prisma.uptimeMonitor.updateMany({
      where: { id: { in: [m1.id, m2.id] } },
      data: { runnerId: localRunner.id },
    });

    const moveFiltered = await fetch(`${baseUrl}/admin/runners/${localRunner.id}/move-monitors`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        toRunnerId: lambdaRunner.id,
        interval: "1m",
      }),
    });
    assert.equal(moveFiltered.status, 200);
    const moveFilteredBody = await moveFiltered.json();
    assert.equal(moveFilteredBody.movedCount, 2, "Only the 2 monitors with interval '1m' should be moved");

    const checkM3 = await prisma.uptimeMonitor.findUnique({ where: { id: m3.id } });
    assert.equal(checkM3.runnerId, localRunner.id, "Monitor m3 (15m) remains on local runner");

    // 10D: Move-monitors Lambda -> Local (entire batch back)
    const moveBack = await fetch(`${baseUrl}/admin/runners/${lambdaRunner.id}/move-monitors`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        toRunnerId: localRunner.id,
      }),
    });
    assert.equal(moveBack.status, 200);
    const moveBackBody = await moveBack.json();
    assert.equal(moveBackBody.movedCount, 2);

    const checkM1 = await prisma.uptimeMonitor.findUnique({ where: { id: m1.id } });
    const checkM2 = await prisma.uptimeMonitor.findUnique({ where: { id: m2.id } });
    assert.equal(checkM1.runnerId, localRunner.id);
    assert.equal(checkM2.runnerId, localRunner.id);

    // 10E: Move-monitors from "default" source
    await prisma.uptimeMonitor.update({ where: { id: m1.id }, data: { runnerId: null } });
    const moveFromDefault = await fetch(`${baseUrl}/admin/runners/default/move-monitors`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        toRunnerId: lambdaRunner.id,
        interval: "1m",
        limit: 1,
      }),
    });
    assert.equal(moveFromDefault.status, 200);
    const moveDefaultBody = await moveFromDefault.json();
    assert.ok(moveDefaultBody.movedCount >= 1);
  });

  // =========================================================================
  // CRITERION 11: Delete runner reassigns monitors to NULL
  // =========================================================================
  it("Criterion 11: Delete runner reassigns monitors to NULL", async () => {
    const timestamp = Date.now();

    const runner = await prisma.uptimeRunner.create({
      data: {
        name: `Phase8 ToDelete ${timestamp}`,
        type: "local",
        isActive: true,
        isDefault: false,
      },
    });

    const m = await prisma.uptimeMonitor.create({
      data: {
        userId: adminUser.id,
        url: "https://todelete-mon.com",
        status: "active",
        runnerId: runner.id,
      },
    });

    const delRes = await fetch(`${baseUrl}/admin/runners/${runner.id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    assert.equal(delRes.status, 200);

    const checkRunner = await prisma.uptimeRunner.findUnique({ where: { id: runner.id } });
    assert.equal(checkRunner, null, "Runner must be deleted");

    const checkMon = await prisma.uptimeMonitor.findUnique({ where: { id: m.id } });
    assert.equal(checkMon.runnerId, null, "Monitor runnerId must be set to NULL on delete");
  });

  // =========================================================================
  // CRITERION 12: Non-admin users get 403 on all runner endpoints
  // =========================================================================
  it("Criterion 12: Non-admin users get 403 on all runner endpoints", async () => {
    const endpoints = [
      { method: "GET", path: "/admin/runners" },
      { method: "POST", path: "/admin/runners", body: { name: "Hack", type: "local" } },
      { method: "PUT", path: "/admin/runners/1/default" },
      { method: "PUT", path: "/admin/runners/1/toggle" },
      { method: "POST", path: "/admin/runners/1/test", body: { testUrl: "https://example.com" } },
      { method: "DELETE", path: "/admin/runners/1" },
      { method: "PATCH", path: "/admin/monitors/1/runner", body: { runnerId: 1 } },
      { method: "POST", path: "/admin/monitors/bulk-runner", body: { monitorIds: [1], runnerId: 1 } },
      { method: "POST", path: "/admin/runners/1/move-monitors", body: { toRunnerId: 2 } },
      { method: "GET", path: "/admin/monitors" },
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: regularHeaders(),
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      assert.equal(
        res.status,
        403,
        `Regular user must receive 403 Forbidden on ${ep.method} ${ep.path}`
      );
    }
  });

  // =========================================================================
  // CRITERION 13: User endpoints & sockets contain no runner/runnerId/runnerName
  // =========================================================================
  it("Criterion 13: User-facing endpoints and socket payloads contain no runner/runnerId/runnerName fields", async () => {
    // 13A: Normal user creates monitor passing runnerId
    const createRes = await fetch(`${baseUrl}/uptime/create`, {
      method: "POST",
      headers: regularHeaders(),
      body: JSON.stringify({
        url: "https://user-secret-runner.example.com",
        interval: "15m",
        runnerId: 9999, // Attempt injection
      }),
    });
    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    const createdMonitor = createBody.monitor;

    assert.equal(createdMonitor.runner, undefined);
    assert.equal(createdMonitor.runnerId, undefined);
    assert.equal(createdMonitor.runnerName, undefined);

    // Verify DB stored runnerId as null
    const dbMon = await prisma.uptimeMonitor.findUnique({
      where: { id: createdMonitor.id },
    });
    assert.equal(dbMon.runnerId, null, "User create must ignore user-submitted runnerId");

    // 13B: Normal user GET /uptime/monitors
    const listRes = await fetch(`${baseUrl}/uptime/monitors`, {
      method: "GET",
      headers: regularHeaders(),
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();

    for (const mon of listBody.monitors || []) {
      assert.equal(mon.runner, undefined);
      assert.equal(mon.runnerId, undefined);
      assert.equal(mon.runnerName, undefined);
      if (mon.lastResult) {
        assert.equal(mon.lastResult.runner, undefined);
        assert.equal(mon.lastResult.runnerId, undefined);
        assert.equal(mon.lastResult.runnerName, undefined);
      }
    }

    // 13C: Normal user GET /uptime/monitor/:id/results
    // Store an internal result with runnerName
    await prisma.uptimeResult.create({
      data: {
        monitorId: createdMonitor.id,
        userId: regularUser.id,
        runnerName: "TopSecretRunnerEngine",
        result: { status: "UP", httpStatus: 200, responseTime: 50 },
      },
    });

    const resultsRes = await fetch(`${baseUrl}/uptime/monitor/${createdMonitor.id}/results`, {
      method: "GET",
      headers: regularHeaders(),
    });
    assert.equal(resultsRes.status, 200);
    const resultsBody = await resultsRes.json();

    for (const r of resultsBody.results || []) {
      assert.equal(r.runner, undefined);
      assert.equal(r.runnerId, undefined);
      assert.equal(r.runnerName, undefined, "runnerName must never be exposed in results history");
    }
  });

  // =========================================================================
  // CRITERION 14: Runner config secrets are never returned by the admin API
  // =========================================================================
  it("Criterion 14: Runner config secrets are never returned by the admin API", async () => {
    const timestamp = Date.now();
    const sensitiveKey = `SECRET_KEY_SUPER_PRIVATE_${timestamp}`;
    const sensitiveArn = `arn:aws:lambda:us-east-1:123456789012:function:private-probe-${timestamp}`;

    const secretRunner = await prisma.uptimeRunner.create({
      data: {
        name: `Phase8 Secret Runner ${timestamp}`,
        type: "lambda",
        config: {
          functionName: "my-function",
          region: "us-east-1",
          apiKey: sensitiveKey,
          functionArn: sensitiveArn,
          secretEnv: "PRIVATE_VAR",
        },
        isActive: true,
        isDefault: false,
      },
    });

    const getRes = await fetch(`${baseUrl}/admin/runners`, {
      method: "GET",
      headers: adminHeaders(),
    });
    assert.equal(getRes.status, 200);
    const body = await getRes.json();

    const target = body.runners.find((r) => r.id === secretRunner.id);
    assert.ok(target, "Created runner must be listed");

    const rawResponseText = JSON.stringify(body);
    assert.ok(
      !rawResponseText.includes(sensitiveKey),
      "Sensitive apiKey must NEVER appear in admin API response"
    );
    assert.ok(
      !rawResponseText.includes(sensitiveArn),
      "Sensitive functionArn must NEVER appear in admin API response"
    );

    // Config must only expose safe whitelist properties
    assert.equal(target.config.apiKey, undefined);
    assert.equal(target.config.functionArn, undefined);
    assert.equal(target.config.functionName, "my-function");
    assert.equal(target.config.region, "us-east-1");
  });
});
