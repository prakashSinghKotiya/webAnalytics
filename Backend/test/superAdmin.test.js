import test, { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcrypt";
import { prisma } from "../src/config/db.prismaSQL.js";
import { ROLES } from "../src/Middleware/authentication.Mw.js";
import { stopPgBoss } from "../src/queue/boss.js";

// Disable automatic background worker startup during test runs
process.env.START_WORKERS_IN_SERVER = "false";

let app;
let server;
let baseUrl;

// Test fixtures
const testUsers = {
  regularUser: {
    name: "Test Regular User",
    email: `test_user_${Date.now()}@test.local`,
    role: ROLES.USER,
  },
  adminUser: {
    name: "Test Admin User",
    email: `test_admin_${Date.now()}@test.local`,
    role: ROLES.ADMIN,
  },
  superAdminUser: {
    name: "Test SuperAdmin User",
    email: `test_superadmin_${Date.now()}@test.local`,
    role: ROLES.SUPER_ADMIN,
  },
  candidateUser: {
    name: "Test Candidate User",
    email: `test_candidate_${Date.now()}@test.local`,
    role: ROLES.USER,
  },
  demoteCandidateUser: {
    name: "Test Demote Candidate",
    email: `test_demote_${Date.now()}@test.local`,
    role: ROLES.ADMIN,
  },
  secondaryAdmin: {
    name: "Test Secondary Admin",
    email: `test_secadmin_${Date.now()}@test.local`,
    role: ROLES.ADMIN,
  },
};

const userRecords = {};
const sessionTokens = {};

before(async () => {
  // Import Express app dynamically after env var is set
  const serverModule = await import("../src/server.js");
  app = serverModule.app;

  // Start HTTP server on an ephemeral port
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  // Seed test users in PostgreSQL
  const hashedPassword = await bcrypt.hash("Password123!", 10);
  for (const [key, fixture] of Object.entries(testUsers)) {
    const user = await prisma.user.create({
      data: {
        name: fixture.name,
        email: fixture.email,
        password: hashedPassword,
        role: fixture.role,
      },
    });
    userRecords[key] = user;

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    sessionTokens[key] = session.id;
  }
});

after(async () => {
  // Clean up created records
  const userIds = Object.values(userRecords).map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.roleAuditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: userIds } },
          { targetId: { in: userIds } },
        ],
      },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.uptimeMonitor.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: userIds } },
    });
  }

  // Close server
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  // Disconnect database client and pg-boss queue pool
  await prisma.$disconnect();
  try {
    await stopPgBoss();
  } catch {}
});

// Helper for making authenticated requests
const apiRequest = async (path, options = {}) => {
  const { sessionToken, headers = {}, ...rest } = options;
  const reqHeaders = {
    "Content-Type": "application/json",
    ...headers,
  };
  if (sessionToken) {
    reqHeaders["Authorization"] = `Bearer ${sessionToken}`;
  }
  const res = await fetch(`${baseUrl}${path}`, {
    headers: reqHeaders,
    ...rest,
  });
  let body = null;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body };
};

describe("SuperAdmin Role and RBAC Test Suite", () => {
  it("Scenario 1: A regular user cannot access admin-only routes", async () => {
    const res = await apiRequest("/admin/users", {
      method: "GET",
      sessionToken: sessionTokens.regularUser,
    });
    assert.strictEqual(res.status, 403, "Regular user should be denied with 403 on /admin/users");
    assert.match(res.body.error, /Admin privileges required|Access denied/i);

    const statsRes = await apiRequest("/admin/monitors/stats", {
      method: "GET",
      sessionToken: sessionTokens.regularUser,
    });
    assert.strictEqual(statsRes.status, 403, "Regular user should be denied on /admin/monitors/stats");
  });

  it("Scenario 2: An admin can access existing admin functionality", async () => {
    const res = await apiRequest("/admin/users", {
      method: "GET",
      sessionToken: sessionTokens.adminUser,
    });
    assert.strictEqual(res.status, 200, "Admin should be able to access /admin/users");
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.users));

    const statsRes = await apiRequest("/admin/monitors/stats", {
      method: "GET",
      sessionToken: sessionTokens.adminUser,
    });
    assert.strictEqual(statsRes.status, 200, "Admin should be able to access monitor stats");
    assert.strictEqual(statsRes.body.success, true);
  });

  it("Scenario 3: A SuperAdmin can access existing admin functionality", async () => {
    const res = await apiRequest("/admin/users", {
      method: "GET",
      sessionToken: sessionTokens.superAdminUser,
    });
    assert.strictEqual(res.status, 200, "SuperAdmin should have full access to /admin/users");
    assert.strictEqual(res.body.success, true);

    const statsRes = await apiRequest("/admin/monitors/stats", {
      method: "GET",
      sessionToken: sessionTokens.superAdminUser,
    });
    assert.strictEqual(statsRes.status, 200, "SuperAdmin should have access to /admin/monitors/stats");
    assert.strictEqual(statsRes.body.success, true);
  });

  it("Scenario 4: An admin cannot promote a user to admin", async () => {
    const candidate = userRecords.candidateUser;
    const res = await apiRequest(`/admin/users/${candidate.id}/promote`, {
      method: "POST",
      sessionToken: sessionTokens.adminUser,
    });
    assert.strictEqual(res.status, 403, "Standard Admin must receive 403 when attempting to promote");
    assert.match(res.body.error, /SuperAdmin privileges required/i);

    // Verify candidate role remains User
    const dbUser = await prisma.user.findUnique({ where: { id: candidate.id } });
    assert.strictEqual(dbUser.role, ROLES.USER);
  });

  it("Scenario 5: An admin cannot demote another admin", async () => {
    const targetAdmin = userRecords.demoteCandidateUser;
    const res = await apiRequest(`/admin/users/${targetAdmin.id}/demote`, {
      method: "POST",
      sessionToken: sessionTokens.adminUser,
    });
    assert.strictEqual(res.status, 403, "Standard Admin must receive 403 when attempting to demote");
    assert.match(res.body.error, /SuperAdmin privileges required/i);

    // Verify target role remains Admin
    const dbUser = await prisma.user.findUnique({ where: { id: targetAdmin.id } });
    assert.strictEqual(dbUser.role, ROLES.ADMIN);
  });

  it("Scenario 6: A SuperAdmin can promote a regular user to admin", async () => {
    const candidate = userRecords.candidateUser;
    const res = await apiRequest(`/admin/users/${candidate.id}/promote`, {
      method: "POST",
      sessionToken: sessionTokens.superAdminUser,
    });
    assert.strictEqual(res.status, 200, "SuperAdmin promotion should succeed with 200");
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.user.role, ROLES.ADMIN);

    // Verify in database
    const dbUser = await prisma.user.findUnique({ where: { id: candidate.id } });
    assert.strictEqual(dbUser.role, ROLES.ADMIN);

    // Verify audit log entry
    const auditLog = await prisma.roleAuditLog.findFirst({
      where: {
        actorId: userRecords.superAdminUser.id,
        targetId: candidate.id,
        action: "PROMOTE_TO_ADMIN",
      },
    });
    assert.ok(auditLog, "Audit log must be recorded for promotion");
    assert.strictEqual(auditLog.oldRole, ROLES.USER);
    assert.strictEqual(auditLog.newRole, ROLES.ADMIN);
  });

  it("Scenario 7: A SuperAdmin can demote an admin to a regular user", async () => {
    const targetAdmin = userRecords.demoteCandidateUser;
    const res = await apiRequest(`/admin/users/${targetAdmin.id}/demote`, {
      method: "POST",
      sessionToken: sessionTokens.superAdminUser,
    });
    assert.strictEqual(res.status, 200, "SuperAdmin demotion should succeed with 200");
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.user.role, ROLES.USER);

    // Verify in database
    const dbUser = await prisma.user.findUnique({ where: { id: targetAdmin.id } });
    assert.strictEqual(dbUser.role, ROLES.USER);

    // Verify audit log entry
    const auditLog = await prisma.roleAuditLog.findFirst({
      where: {
        actorId: userRecords.superAdminUser.id,
        targetId: targetAdmin.id,
        action: "DEMOTE_TO_USER",
      },
    });
    assert.ok(auditLog, "Audit log must be recorded for demotion");
    assert.strictEqual(auditLog.oldRole, ROLES.ADMIN);
    assert.strictEqual(auditLog.newRole, ROLES.USER);
  });

  it("Scenario 8: A user cannot promote themselves", async () => {
    // SuperAdmin attempting to promote themselves
    const resSuper = await apiRequest(`/admin/users/${userRecords.superAdminUser.id}/promote`, {
      method: "POST",
      sessionToken: sessionTokens.superAdminUser,
    });
    assert.strictEqual(resSuper.status, 400);
    assert.match(resSuper.body.error, /Self-promotion is not permitted/i);

    // Regular user attempting to promote themselves (blocked by middleware with 403)
    const resUser = await apiRequest(`/admin/users/${userRecords.regularUser.id}/promote`, {
      method: "POST",
      sessionToken: sessionTokens.regularUser,
    });
    assert.strictEqual(resUser.status, 403);
  });

  it("Scenario 9: A SuperAdmin cannot be modified through ordinary admin-management endpoints", async () => {
    // Attempt to demote a SuperAdmin via demote endpoint
    const resDemote = await apiRequest(`/admin/users/${userRecords.superAdminUser.id}/demote`, {
      method: "POST",
      sessionToken: sessionTokens.superAdminUser,
    });
    // Either self-demotion rejected or SuperAdmin modification rejected
    assert.ok(resDemote.status === 400 || resDemote.status === 403);

    // An ordinary Admin attempting to delete a SuperAdmin via DeleteUser
    const resDelete = await apiRequest(`/admin/users/${userRecords.superAdminUser.id}`, {
      method: "DELETE",
      sessionToken: sessionTokens.adminUser,
    });
    assert.strictEqual(resDelete.status, 403);
    assert.match(resDelete.body.error, /SuperAdmin accounts cannot be deleted/i);

    // An ordinary Admin attempting to force logout a SuperAdmin
    const resLogout = await apiRequest(`/admin/users/${userRecords.superAdminUser.id}/logout`, {
      method: "POST",
      sessionToken: sessionTokens.adminUser,
    });
    assert.strictEqual(resLogout.status, 403);
    assert.match(resLogout.body.error, /Cannot force logout a SuperAdmin/i);
  });

  it("Scenario 10: A user cannot assign themselves or another user the SUPER_ADMIN role through registration or profile APIs", async () => {
    // Attempt mass assignment through registration payload
    const testRegEmail = `test_hacker_${Date.now()}@test.local`;
    const regRes = await apiRequest("/user/register", {
      method: "POST",
      body: JSON.stringify({
        name: "Hacker Account",
        email: testRegEmail,
        password: "Password123!",
        otp: "1234",
        role: "SuperAdmin", // Malicious role injection attempt
      }),
    });
    // OTP will be rejected, but even if checked, registerSchema does not accept role
    assert.ok(regRes.status === 400 || regRes.status === 404);

    // SuperAdmin role cannot be assigned via the role endpoint
    const patchRes = await apiRequest(`/admin/users/${userRecords.regularUser.id}/role`, {
      method: "PATCH",
      sessionToken: sessionTokens.superAdminUser,
      body: JSON.stringify({ role: "SuperAdmin" }),
    });
    assert.strictEqual(patchRes.status, 403);
    assert.match(patchRes.body.error, /SuperAdmin role cannot be assigned through ordinary management APIs/i);
  });

  it("Scenario 11: Invalid user IDs and unsupported role transitions are rejected", async () => {
    // Non-numeric ID
    const resInvalidId = await apiRequest("/admin/users/abc/promote", {
      method: "POST",
      sessionToken: sessionTokens.superAdminUser,
    });
    assert.strictEqual(resInvalidId.status, 400);
    assert.strictEqual(resInvalidId.body.error, "Invalid user ID");

    // Negative ID
    const resNegativeId = await apiRequest("/admin/users/-5/promote", {
      method: "POST",
      sessionToken: sessionTokens.superAdminUser,
    });
    assert.strictEqual(resNegativeId.status, 400);

    // Non-existent user
    const resNotFound = await apiRequest("/admin/users/99999999/promote", {
      method: "POST",
      sessionToken: sessionTokens.superAdminUser,
    });
    assert.strictEqual(resNotFound.status, 404);

    // Idempotent promotion: promoting someone who is already Admin
    const resIdempotent = await apiRequest(`/admin/users/${userRecords.adminUser.id}/promote`, {
      method: "POST",
      sessionToken: sessionTokens.superAdminUser,
    });
    assert.strictEqual(resIdempotent.status, 200);
    assert.strictEqual(resIdempotent.body.message, "User is already an Admin");
  });

  it("Scenario 12: Revoked administrative privileges are enforced even when an old session or token exists", async () => {
    // 1. Create a temporary admin with an active session
    const tempAdmin = await prisma.user.create({
      data: {
        name: "Temporary Admin",
        email: `temp_admin_${Date.now()}@test.local`,
        password: "Password123!",
        role: ROLES.ADMIN,
      },
    });
    const session = await prisma.session.create({
      data: {
        userId: tempAdmin.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    const oldSessionToken = session.id;

    // Verify tempAdmin can initially access /admin/users
    const initialCheck = await apiRequest("/admin/users", {
      method: "GET",
      sessionToken: oldSessionToken,
    });
    assert.strictEqual(initialCheck.status, 200, "Initial admin access should succeed");

    // 2. SuperAdmin demotes tempAdmin
    const demoteRes = await apiRequest(`/admin/users/${tempAdmin.id}/demote`, {
      method: "POST",
      sessionToken: sessionTokens.superAdminUser,
    });
    assert.strictEqual(demoteRes.status, 200);

    // 3. Immediately test accessing an admin endpoint with the old session token
    const revokedCheck = await apiRequest("/admin/users", {
      method: "GET",
      sessionToken: oldSessionToken,
    });
    // Old session was deleted in DB on demotion -> returns 401
    assert.strictEqual(revokedCheck.status, 401, "Revoked session must immediately fail with 401");

    // 4. Even if a fresh session is established for this demoted user, they are now a regular User -> returns 403
    const newSession = await prisma.session.create({
      data: {
        userId: tempAdmin.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    const postDemoteCheck = await apiRequest("/admin/users", {
      method: "GET",
      sessionToken: newSession.id,
    });
    assert.strictEqual(postDemoteCheck.status, 403, "Demoted user cannot access admin routes with new session");

    // Cleanup tempAdmin
    await prisma.roleAuditLog.deleteMany({ where: { targetId: tempAdmin.id } });
    await prisma.session.deleteMany({ where: { userId: tempAdmin.id } });
    await prisma.user.delete({ where: { id: tempAdmin.id } });
  });

  it("Scenario 13: Existing user and admin workflows continue to work", async () => {
    // Admin listing users
    const usersRes = await apiRequest("/admin/users", {
      method: "GET",
      sessionToken: sessionTokens.adminUser,
    });
    assert.strictEqual(usersRes.status, 200);

    // Admin filtering users by role
    const filteredRes = await apiRequest("/admin/users?role=admin", {
      method: "GET",
      sessionToken: sessionTokens.adminUser,
    });
    assert.strictEqual(filteredRes.status, 200);
    assert.ok(filteredRes.body.users.every((u) => u.role === "Admin"));

    // User viewing their details on /user/home
    const userHomeRes = await apiRequest("/user/home", {
      method: "GET",
      sessionToken: sessionTokens.regularUser,
    });
    assert.strictEqual(userHomeRes.status, 200);
    assert.strictEqual(userHomeRes.body.email, testUsers.regularUser.email);
    assert.strictEqual(userHomeRes.body.role, ROLES.USER);

    // Admin cannot delete another Admin
    const adminDeleteAdmin = await apiRequest(`/admin/users/${userRecords.secondaryAdmin.id}`, {
      method: "DELETE",
      sessionToken: sessionTokens.adminUser,
    });
    assert.strictEqual(adminDeleteAdmin.status, 403);
    assert.match(adminDeleteAdmin.body.error, /Only a SuperAdmin can delete an Admin account/i);
  });

  it("Scenario 14: Concurrent role changes do not leave the database in an inconsistent state", async () => {
    const concurrentUser = await prisma.user.create({
      data: {
        name: "Concurrent Test User",
        email: `concurrent_${Date.now()}@test.local`,
        password: "Password123!",
        role: ROLES.USER,
      },
    });

    // Execute 5 simultaneous promotion requests from SuperAdmin
    const promises = Array.from({ length: 5 }, () =>
      apiRequest(`/admin/users/${concurrentUser.id}/promote`, {
        method: "POST",
        sessionToken: sessionTokens.superAdminUser,
      })
    );

    const results = await Promise.all(promises);
    for (const r of results) {
      assert.strictEqual(r.status, 200, "All concurrent requests should return 200 (idempotent)");
    }

    // Verify user role is valid in DB
    const finalUser = await prisma.user.findUnique({ where: { id: concurrentUser.id } });
    assert.strictEqual(finalUser.role, ROLES.ADMIN);

    // Clean up
    await prisma.roleAuditLog.deleteMany({ where: { targetId: concurrentUser.id } });
    await prisma.session.deleteMany({ where: { userId: concurrentUser.id } });
    await prisma.user.delete({ where: { id: concurrentUser.id } });
  });
});
