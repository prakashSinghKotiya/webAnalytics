import { prisma } from "../config/db.prismaSQL.js";

const isUuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Role definitions and hierarchy
export const ROLES = Object.freeze({
  USER: "User",
  ADMIN: "Admin",
  SUPER_ADMIN: "SuperAdmin",
});

export const ROLE_HIERARCHY = Object.freeze({
  [ROLES.USER]: 1,
  [ROLES.ADMIN]: 2,
  [ROLES.SUPER_ADMIN]: 3,
});

/**
 * Checks if a user object meets or exceeds the required minimum role in the hierarchy.
 * @param {Object} user - The user object from session or request
 * @param {string} minimumRole - One of ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN
 * @returns {boolean}
 */
export const hasMinimumRole = (user, minimumRole) => {
  if (!user || !user.role) return false;
  const userRank = ROLE_HIERARCHY[user.role] ?? 0;
  const requiredRank = ROLE_HIERARCHY[minimumRole] ?? Infinity;
  return userRank >= requiredRank;
};

export const isUserAdmin = (user) => hasMinimumRole(user, ROLES.ADMIN);
export const isUserSuperAdmin = (user) => hasMinimumRole(user, ROLES.SUPER_ADMIN);

/**
 * Primary session authentication middleware.
 * Verifies the opaque session UUID from cookies, Authorization header, or x-session-id.
 * Attaches fresh user data from PostgreSQL (omitting password hash) to req.user.
 */
export default async function checkAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    const sid = req.signedCookies?.sid || bearerToken || req.headers["x-session-id"];

    if (!sid || !isUuid(sid)) {
      return res.status(401).json({ error: "not logged " });
    }

    // one query: session + its user. Expiry is checked here because postgres has no TTL auto-delete.
    // password hash is left out of req.user. Live DB query ensures role updates/demotions take effect immediately.
    const session = await prisma.session.findFirst({
      where: { id: sid, expiresAt: { gt: new Date() } },
      include: { user: { omit: { password: true } } },
    });
    if (!session) {
      return res.status(401).json({ error: "not logged " });
    }

    const user = session.user;
    if (!user || user.deleted) {
      return res.status(401).json({ error: "user not found" });
    }

    req.user = user;
    req.sessionId = session.id;
    next();
  } catch (error) {
    console.error("[checkAuth] Middleware error:", error);
    return res.status(500).json({ error: "Internal authentication error" });
  }
}

/**
 * Middleware factory for arbitrary minimum role requirement.
 */
export const requireRole = (minimumRole) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (hasMinimumRole(req.user, minimumRole)) {
    return next();
  }
  return res.status(403).json({
    error: `Access denied: ${minimumRole} privileges required`,
  });
};

/**
 * Admin check middleware.
 * Verifies that the authenticated user possesses at least Admin privileges (Admin or SuperAdmin).
 * Rejects regular users and unknown/invalid roles.
 */
export const adminChecker = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (isUserAdmin(req.user)) {
    return next();
  }
  return res.status(403).json({ error: "Access denied: Admin privileges required" });
};

/**
 * RBAC middleware for administrative operations.
 * Allows both Admin and SuperAdmin access to maintain role hierarchy.
 */
export const isAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (isUserAdmin(req.user)) {
    return next();
  }
  return res.status(403).json({ error: "Access denied: Admin role required" });
};

/**
 * SuperAdmin exclusive middleware.
 * Strictly verifies that the authenticated user has the SuperAdmin role.
 * Standard Admins and Users are rejected with 403 Forbidden.
 */
export const isSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (req.user.role === ROLES.SUPER_ADMIN) {
    return next();
  }
  return res.status(403).json({ error: "Access denied: SuperAdmin privileges required" });
};

export const requireSuperAdmin = isSuperAdmin;
