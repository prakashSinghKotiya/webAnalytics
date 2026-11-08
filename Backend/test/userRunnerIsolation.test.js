import test, { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { prisma } from "../src/config/db.prismaSQL.js";
import { ROLES } from "../src/Middleware/authentication.Mw.js";
import { clearRunnerCache } from "../src/Services/runners/index.js";
import { stopPgBoss } from "../src/queue/boss.js";

process.env.START_WORKERS_IN_SERVER = "false";

describe("Phase 6: User-Facing Runner Isolation & Security Test Suite", () => {
  let app;
  let server;
  let baseUrl;
  let regularUser;
  let regularSid;
  let testRunner;
  let assignedMonitor;

  before(async () => {
    const serverModule = await import("../src/server.js");
    app = serverModule.app;

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Create Regular user and session
    regularUser = await prisma.user.create({
      data: {
        name: "Regular Isolation Tester",
        email: `isolation_user_${Date.now()}@test.local`,
        role: ROLES.USER,
      },
    });
    const regularSession = await prisma.session.create({
      data: { userId: regularUser.id },
    });
    regularSid = regularSession.id;

    // Create a dedicated runner to test assignment isolation
    testRunner = await prisma.uptimeRunner.create({
      data: {
        name: `Isolated Runner ${Date.now()}`,
        type: "lambda",
        config: { functionName: "arn:aws:lambda:us-east-1:123456789012:function:test" },
        isActive: true,
        isDefault: false,
      },
    });

    // Create a monitor assigned to testRunner with runnerName in lastResult
    assignedMonitor = await prisma.uptimeMonitor.create({
      data: {
        userId: regularUser.id,
        url: `https://assigned-mon-${Date.now()}.example.com`,
        interval: "m15",
        status: "active",
        runnerId: testRunner.id,
        lastResult: {
          status: "UP",
          responseTime: 120,
          httpStatus: 200,
          runnerName: testRunner.name,
          runnerId: testRunner.id,
        },
      },
    });

    // Create a historical result on assignedMonitor with runnerName populated in DB
    await prisma.uptimeResult.create({
      data: {
        monitorId: assignedMonitor.id,
        userId: regularUser.id,
        result: { status: "UP", responseTime: 120, httpStatus: 200 },
        runnerName: testRunner.name,
        checkedAt: new Date(),
      },
    });

    clearRunnerCache();
  });

  after(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    await prisma.$disconnect();
    try {
      await stopPgBoss();
    } catch {}
  });

  const userHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${regularSid}`,
  });

  // 1. User create monitor ignores runnerId and never exposes runner fields
  it("POST /uptime/create ignores runnerId and does not expose runner info", async () => {
    const targetUrl = `https://create-isolate-${Date.now()}.example.com`;
    const res = await fetch(`${baseUrl}/uptime/create`, {
      method: "POST",
      headers: userHeaders(),
      body: JSON.stringify({
        url: targetUrl,
        interval: "15m",
        runnerId: testRunner.id, // User attempts to specify a runner
        runnerName: "Hacked Runner",
      }),
    });

    assert.equal(res.status, 201, `Expected 201 Created, got ${res.status}`);
    const data = await res.json();
    assert.ok(data.monitor);

    // Verify response body never leaks runner details
    assert.equal(data.monitor.runnerId, undefined, "Response must not contain runnerId");
    assert.equal(data.monitor.runner, undefined, "Response must not contain runner relation");
    assert.equal(data.monitor.runnerName, undefined, "Response must not contain runnerName");

    // Verify database row defaulted to null runnerId (system default runner)
    const dbMonitor = await prisma.uptimeMonitor.findUnique({
      where: { id: data.monitor.id },
    });
    assert.equal(dbMonitor.runnerId, null, "DB runnerId must remain null on user create");
  });

  // 2. User update monitor ignores runnerId and never exposes runner fields
  it("PUT /uptime/update/:id ignores runnerId and does not expose runner info", async () => {
    const newUrl = `https://updated-mon-${Date.now()}.example.com`;
    const res = await fetch(`${baseUrl}/uptime/update/${assignedMonitor.id}`, {
      method: "PUT",
      headers: userHeaders(),
      body: JSON.stringify({
        url: newUrl,
        interval: "30m",
        status: "active",
        runnerId: null, // User attempts to alter runnerId
        runnerName: "Injected Runner",
      }),
    });

    assert.equal(res.status, 200, `Expected 200 OK, got ${res.status}`);
    const data = await res.json();
    assert.ok(data.monitor);

    // Verify response body never leaks runner details
    assert.equal(data.monitor.runnerId, undefined, "Response must not contain runnerId");
    assert.equal(data.monitor.runner, undefined, "Response must not contain runner relation");
    assert.equal(data.monitor.runnerName, undefined, "Response must not contain runnerName");

    // Verify database row runnerId was untouched
    const dbMonitor = await prisma.uptimeMonitor.findUnique({
      where: { id: assignedMonitor.id },
    });
    assert.equal(dbMonitor.runnerId, testRunner.id, "DB runnerId must not be modified by user update");
  });

  // 3. User pause and resume endpoints do not leak runner info
  it("PATCH /uptime/pause/:id and resume do not expose runner info", async () => {
    // Pause
    const pauseRes = await fetch(`${baseUrl}/uptime/pause/${assignedMonitor.id}`, {
      method: "PATCH",
      headers: userHeaders(),
    });
    assert.equal(pauseRes.status, 200);
    const pauseData = await pauseRes.json();
    assert.equal(pauseData.monitor.runnerId, undefined);
    assert.equal(pauseData.monitor.runner, undefined);
    assert.equal(pauseData.monitor.runnerName, undefined);

    // Resume
    const resumeRes = await fetch(`${baseUrl}/uptime/resume/${assignedMonitor.id}`, {
      method: "PATCH",
      headers: userHeaders(),
    });
    assert.equal(resumeRes.status, 200);
    const resumeData = await resumeRes.json();
    assert.equal(resumeData.monitor.runnerId, undefined);
    assert.equal(resumeData.monitor.runner, undefined);
    assert.equal(resumeData.monitor.runnerName, undefined);
  });

  // 4. GET /uptime/monitors strips runnerId, runner, and runnerName from monitors and lastResult
  it("GET /uptime/monitors never contains runner, runnerId, or runnerName in monitors or lastResult", async () => {
    const res = await fetch(`${baseUrl}/uptime/monitors`, {
      method: "GET",
      headers: userHeaders(),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.monitors));
    assert.ok(data.monitors.length > 0);

    for (const m of data.monitors) {
      assert.equal(m.runnerId, undefined, `Monitor ${m.id} leaked runnerId`);
      assert.equal(m.runner, undefined, `Monitor ${m.id} leaked runner relation`);
      assert.equal(m.runnerName, undefined, `Monitor ${m.id} leaked runnerName`);

      if (m.lastResult) {
        assert.equal(m.lastResult.runnerName, undefined, `Monitor ${m.id} leaked runnerName in lastResult`);
        assert.equal(m.lastResult.runnerId, undefined, `Monitor ${m.id} leaked runnerId in lastResult`);
        assert.equal(m.lastResult.runner, undefined, `Monitor ${m.id} leaked runner in lastResult`);
      }
    }
  });

  // 5. GET /uptime/monitor/:id never contains runner details or runnerName in lastResult
  it("GET /uptime/monitor/:id never contains runner, runnerId, or runnerName", async () => {
    const res = await fetch(`${baseUrl}/uptime/monitor/${assignedMonitor.id}`, {
      method: "GET",
      headers: userHeaders(),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.monitor);

    assert.equal(data.monitor.runnerId, undefined, "Monitor details leaked runnerId");
    assert.equal(data.monitor.runner, undefined, "Monitor details leaked runner relation");
    assert.equal(data.monitor.runnerName, undefined, "Monitor details leaked runnerName");

    if (data.monitor.lastResult) {
      assert.equal(data.monitor.lastResult.runnerName, undefined, "lastResult leaked runnerName");
      assert.equal(data.monitor.lastResult.runnerId, undefined, "lastResult leaked runnerId");
      assert.equal(data.monitor.lastResult.runner, undefined, "lastResult leaked runner");
    }
  });

  // 6. GET /uptime/monitor/:id/results never returns runnerName to regular users
  it("GET /uptime/monitor/:id/results never returns runnerName even when stored in DB", async () => {
    const res = await fetch(`${baseUrl}/uptime/monitor/${assignedMonitor.id}/results`, {
      method: "GET",
      headers: userHeaders(),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.results));
    assert.ok(data.results.length > 0);

    for (const r of data.results) {
      assert.equal(r.runnerName, undefined, `Result ${r.id} leaked runnerName`);
      assert.equal(r.runner, undefined, `Result ${r.id} leaked runner`);
      assert.equal(r.runnerId, undefined, `Result ${r.id} leaked runnerId`);
    }
  });
});
