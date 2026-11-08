import test, { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { prisma } from "../src/config/db.prismaSQL.js";
import { ROLES } from "../src/Middleware/authentication.Mw.js";
import { clearRunnerCache } from "../src/Services/runners/index.js";
import { stopPgBoss } from "../src/queue/boss.js";

process.env.START_WORKERS_IN_SERVER = "false";

describe("Phase 5: Admin Runner Routing & Management API Test Suite", () => {
  let app;
  let server;
  let baseUrl;
  let adminUser;
  let regularUser;
  let adminSid;
  let regularSid;

  before(async () => {
    const serverModule = await import("../src/server.js");
    app = serverModule.app;

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Create Admin user and session
    adminUser = await prisma.user.create({
      data: {
        name: "Admin Runner Tester",
        email: `admin_runner_${Date.now()}@test.local`,
        role: ROLES.ADMIN,
      },
    });
    const adminSession = await prisma.session.create({
      data: { userId: adminUser.id },
    });
    adminSid = adminSession.id;

    // Create Regular user and session
    regularUser = await prisma.user.create({
      data: {
        name: "Regular Runner Tester",
        email: `regular_runner_${Date.now()}@test.local`,
        role: ROLES.USER,
      },
    });
    const regularSession = await prisma.session.create({
      data: { userId: regularUser.id },
    });
    regularSid = regularSession.id;

    // Ensure default Main Server exists
    await prisma.uptimeRunner.upsert({
      where: { name: "Main Server" },
      update: { type: "local", isActive: true, isDefault: true },
      create: { name: "Main Server", type: "local", isActive: true, isDefault: true },
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

  const adminHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminSid}`,
  });

  const regularHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${regularSid}`,
  });

  // 1. RBAC protection
  it("rejects non-admin users with 403 Forbidden on runner endpoints", async () => {
    const endpoints = [
      { method: "GET", url: "/admin/runners" },
      { method: "POST", url: "/admin/runners", body: { name: "X", type: "local" } },
      { method: "PUT", url: "/admin/runners/1/default" },
      { method: "PUT", url: "/admin/runners/1/toggle" },
      { method: "POST", url: "/admin/runners/1/move-monitors" },
      { method: "PATCH", url: "/admin/monitors/1/runner" },
      { method: "POST", url: "/admin/monitors/bulk-runner" },
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep.url}`, {
        method: ep.method,
        headers: regularHeaders(),
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      assert.equal(
        res.status,
        403,
        `Expected 403 for regular user on ${ep.method} ${ep.url}, got ${res.status}`
      );
    }
  });

  // 2. GET /admin/runners
  it("GET /admin/runners returns runners with monitor counts and masks secrets", async () => {
    const res = await fetch(`${baseUrl}/admin/runners`, {
      method: "GET",
      headers: adminHeaders(),
    });
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.runners));
    assert.ok(typeof data.defaultMonitorCount === "number");

    // Verify config is sanitized/masked
    for (const runner of data.runners) {
      assert.ok(runner.config !== undefined);
      assert.equal(runner.config.secret, undefined);
      assert.equal(runner.config.secretAccessKey, undefined);
      assert.ok(typeof runner.monitorCount === "number");
    }
  });

  // 3. POST /admin/runners
  it("POST /admin/runners creates a new runner with isActive: true", async () => {
    const uniqueName = `Lambda Fleet ${Date.now()}`;
    const res = await fetch(`${baseUrl}/admin/runners`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        name: uniqueName,
        type: "lambda",
        config: {
          functionName: "arn:aws:lambda:us-east-1:123456789012:function:uptime-checker",
          batchSize: 100,
        },
      }),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.runner.name, uniqueName);
    assert.equal(data.runner.type, "lambda");
    assert.equal(data.runner.isActive, true, "New runner must default to isActive: true");
    assert.equal(data.runner.isDefault, false);
  });

  // 4. PUT /admin/runners/:id/default and PUT /admin/runners/:id/activate
  it("PUT /admin/runners/:id/default switches default runner atomically", async () => {
    // Create an enabled runner
    const runner = await prisma.uptimeRunner.create({
      data: {
        name: `New Default Test ${Date.now()}`,
        type: "local",
        isActive: true,
        isDefault: false,
      },
    });

    const res = await fetch(`${baseUrl}/admin/runners/${runner.id}/default`, {
      method: "PUT",
      headers: adminHeaders(),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.runner.isDefault, true);
    assert.ok(data.message.includes("instantly moves all unassigned monitors"));

    // Verify exactly one runner in the DB has isDefault = true
    const defaultRunners = await prisma.uptimeRunner.findMany({
      where: { isDefault: true },
    });
    assert.equal(defaultRunners.length, 1);
    assert.equal(defaultRunners[0].id, runner.id);

    // Test deprecated alias /activate switches back to Main Server
    const mainServer = await prisma.uptimeRunner.findUnique({
      where: { name: "Main Server" },
    });
    const aliasRes = await fetch(`${baseUrl}/admin/runners/${mainServer.id}/activate`, {
      method: "PUT",
      headers: adminHeaders(),
    });
    assert.equal(aliasRes.status, 200);
    const aliasData = await aliasRes.json();
    assert.equal(aliasData.runner.id, mainServer.id);
    assert.equal(aliasData.runner.isDefault, true);
  });

  it("PUT /admin/runners/:id/default rejects disabled runner with 400", async () => {
    const disabledRunner = await prisma.uptimeRunner.create({
      data: {
        name: `Disabled Runner ${Date.now()}`,
        type: "local",
        isActive: false,
        isDefault: false,
      },
    });

    const res = await fetch(`${baseUrl}/admin/runners/${disabledRunner.id}/default`, {
      method: "PUT",
      headers: adminHeaders(),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("disabled"));
  });

  // 5. PUT /admin/runners/:id/toggle
  it("PUT /admin/runners/:id/toggle toggles active state and prevents disabling default", async () => {
    const runner = await prisma.uptimeRunner.create({
      data: {
        name: `Toggle Test ${Date.now()}`,
        type: "local",
        isActive: true,
        isDefault: false,
      },
    });

    // Disable
    const res1 = await fetch(`${baseUrl}/admin/runners/${runner.id}/toggle`, {
      method: "PUT",
      headers: adminHeaders(),
    });
    assert.equal(res1.status, 200);
    const data1 = await res1.json();
    assert.equal(data1.runner.isActive, false);

    // Re-enable
    const res2 = await fetch(`${baseUrl}/admin/runners/${runner.id}/toggle`, {
      method: "PUT",
      headers: adminHeaders(),
    });
    assert.equal(res2.status, 200);
    const data2 = await res2.json();
    assert.equal(data2.runner.isActive, true);

    // Attempt to disable the default runner (must reject with 400)
    const mainServer = await prisma.uptimeRunner.findUnique({
      where: { name: "Main Server" },
    });
    const failRes = await fetch(`${baseUrl}/admin/runners/${mainServer.id}/toggle`, {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(failRes.status, 400);
    const failData = await failRes.json();
    assert.ok(failData.error.includes("Cannot disable the default runner"));
  });

  // 6. DELETE /admin/runners/:id
  it("DELETE /admin/runners/:id prevents deleting default and reassigns monitors to NULL", async () => {
    const mainServer = await prisma.uptimeRunner.findUnique({
      where: { name: "Main Server" },
    });

    // Cannot delete default
    const failRes = await fetch(`${baseUrl}/admin/runners/${mainServer.id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    assert.equal(failRes.status, 400);

    // Create runner with 2 assigned monitors
    const runnerToDelete = await prisma.uptimeRunner.create({
      data: {
        name: `Delete Target ${Date.now()}`,
        type: "local",
        isActive: false,
        isDefault: false,
      },
    });

    const m1 = await prisma.uptimeMonitor.create({
      data: {
        userId: adminUser.id,
        url: `https://del-target-1-${Date.now()}.example.com`,
        runnerId: runnerToDelete.id,
      },
    });
    const m2 = await prisma.uptimeMonitor.create({
      data: {
        userId: adminUser.id,
        url: `https://del-target-2-${Date.now()}.example.com`,
        runnerId: runnerToDelete.id,
      },
    });

    const delRes = await fetch(`${baseUrl}/admin/runners/${runnerToDelete.id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    assert.equal(delRes.status, 200);

    // Verify monitors were reassigned to null
    const check1 = await prisma.uptimeMonitor.findUnique({ where: { id: m1.id } });
    const check2 = await prisma.uptimeMonitor.findUnique({ where: { id: m2.id } });
    assert.equal(check1.runnerId, null);
    assert.equal(check2.runnerId, null);
  });

  // 7. PATCH /admin/monitors/:id/runner & POST /admin/monitors/bulk-runner
  it("assigns single and bulk monitors to a runner or null", async () => {
    const targetRunner = await prisma.uptimeRunner.create({
      data: {
        name: `Assignment Runner ${Date.now()}`,
        type: "local",
        isActive: true,
        isDefault: false,
      },
    });

    const monitor = await prisma.uptimeMonitor.create({
      data: {
        userId: adminUser.id,
        url: `https://single-assign-${Date.now()}.example.com`,
        runnerId: null,
      },
    });

    // Assign single monitor to runner
    const patchRes = await fetch(`${baseUrl}/admin/monitors/${monitor.id}/runner`, {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ runnerId: targetRunner.id }),
    });
    assert.equal(patchRes.status, 200);
    const patchData = await patchRes.json();
    assert.equal(patchData.monitor.runnerId, targetRunner.id);

    // Reset single monitor to default (null)
    const resetRes = await fetch(`${baseUrl}/admin/monitors/${monitor.id}/runner`, {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ runnerId: null }),
    });
    assert.equal(resetRes.status, 200);
    const resetData = await resetRes.json();
    assert.equal(resetData.monitor.runnerId, null);

    // Bulk assignment
    const bulkMon1 = await prisma.uptimeMonitor.create({
      data: { userId: adminUser.id, url: `https://bulk-1-${Date.now()}.example.com` },
    });
    const bulkMon2 = await prisma.uptimeMonitor.create({
      data: { userId: adminUser.id, url: `https://bulk-2-${Date.now()}.example.com` },
    });

    const bulkRes = await fetch(`${baseUrl}/admin/monitors/bulk-runner`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        monitorIds: [bulkMon1.id, bulkMon2.id],
        runnerId: targetRunner.id,
      }),
    });
    assert.equal(bulkRes.status, 200);
    const bulkData = await bulkRes.json();
    assert.equal(bulkData.count, 2);

    const ref1 = await prisma.uptimeMonitor.findUnique({ where: { id: bulkMon1.id } });
    const ref2 = await prisma.uptimeMonitor.findUnique({ where: { id: bulkMon2.id } });
    assert.equal(ref1.runnerId, targetRunner.id);
    assert.equal(ref2.runnerId, targetRunner.id);
  });

  // 8. POST /admin/runners/:id/move-monitors
  it("POST /admin/runners/:id/move-monitors moves batches bidirectionally and supports filters", async () => {
    const runnerA = await prisma.uptimeRunner.create({
      data: {
        name: `Move Runner A ${Date.now()}`,
        type: "local",
        isActive: true,
        isDefault: false,
      },
    });

    const runnerB = await prisma.uptimeRunner.create({
      data: {
        name: `Move Runner B ${Date.now()}`,
        type: "local",
        isActive: true,
        isDefault: false,
      },
    });

    // Seed 4 monitors on runner A (2 with 5m, 2 with 10m)
    const m1 = await prisma.uptimeMonitor.create({
      data: { userId: adminUser.id, url: `https://move-1-${Date.now()}.example.com`, interval: "m5", runnerId: runnerA.id },
    });
    const m2 = await prisma.uptimeMonitor.create({
      data: { userId: adminUser.id, url: `https://move-2-${Date.now()}.example.com`, interval: "m5", runnerId: runnerA.id },
    });
    const m3 = await prisma.uptimeMonitor.create({
      data: { userId: adminUser.id, url: `https://move-3-${Date.now()}.example.com`, interval: "m10", runnerId: runnerA.id },
    });
    const m4 = await prisma.uptimeMonitor.create({
      data: { userId: adminUser.id, url: `https://move-4-${Date.now()}.example.com`, interval: "m10", runnerId: runnerA.id },
    });

    // Move only 5m interval from A -> B
    const filterMoveRes = await fetch(`${baseUrl}/admin/runners/${runnerA.id}/move-monitors`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        toRunnerId: runnerB.id,
        interval: "5m",
      }),
    });
    assert.equal(filterMoveRes.status, 200);
    const filterData = await filterMoveRes.json();
    assert.equal(filterData.movedCount, 2);

    // Verify 5m monitors are on B, 10m monitors remain on A
    const refM1 = await prisma.uptimeMonitor.findUnique({ where: { id: m1.id } });
    const refM3 = await prisma.uptimeMonitor.findUnique({ where: { id: m3.id } });
    assert.equal(refM1.runnerId, runnerB.id);
    assert.equal(refM3.runnerId, runnerA.id);

    // Move ALL remaining from A -> B (full batch move)
    const fullMoveRes = await fetch(`${baseUrl}/admin/runners/${runnerA.id}/move-monitors`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ toRunnerId: runnerB.id }),
    });
    assert.equal(fullMoveRes.status, 200);
    const fullData = await fullMoveRes.json();
    assert.equal(fullData.movedCount, 2);

    // Now all 4 are on runner B. Move all 4 from B -> Default (NULL) (reverse direction)
    const backToDefaultRes = await fetch(`${baseUrl}/admin/runners/${runnerB.id}/move-monitors`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ toRunnerId: null }),
    });
    assert.equal(backToDefaultRes.status, 200);
    const backData = await backToDefaultRes.json();
    assert.equal(backData.movedCount, 4);

    // Move from "default" source back to Runner A with limit: 2
    const moveFromDefaultRes = await fetch(`${baseUrl}/admin/runners/default/move-monitors`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        toRunnerId: runnerA.id,
        limit: 2,
      }),
    });
    assert.equal(moveFromDefaultRes.status, 200);
    const fromDefData = await moveFromDefaultRes.json();
    assert.equal(fromDefData.movedCount, 2);
  });

  // 9. GET /admin/monitors pagination & runnerId filter
  it("GET /admin/monitors filters by runnerId and includes runner metadata", async () => {
    const runner = await prisma.uptimeRunner.create({
      data: {
        name: `Filter Runner ${Date.now()}`,
        type: "local",
        isActive: true,
        isDefault: false,
      },
    });

    const m = await prisma.uptimeMonitor.create({
      data: {
        userId: adminUser.id,
        url: `https://filtered-mon-${Date.now()}.example.com`,
        runnerId: runner.id,
      },
    });

    const res = await fetch(`${baseUrl}/admin/monitors?runnerId=${runner.id}`, {
      method: "GET",
      headers: adminHeaders(),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.data.length >= 1);
    const found = data.data.find((item) => item.id === m.id);
    assert.ok(found);
    assert.equal(found.runnerId, runner.id);
    assert.equal(found.runner.name, runner.name);
  });
});
