import { prisma } from "../config/db.prismaSQL.js";
import { ROLES } from "../Middleware/authentication.Mw.js";

/**
 * Normalizes user response object omitting sensitive attributes.
 */
const formatUserResponse = (user) => {
  if (!user) return null;
  return {
    id: user.id,
    _id: user.id,
    name: user.name,
    email: user.email,
    picture: user.picture,
    role: user.role,
    plan: user.plans || "free",
    plans: user.plans || "free",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

/**
 * POST /admin/users/:userId/promote
 * SuperAdmin-only endpoint to promote an existing User to Admin.
 */
export const promoteUserToAdmin = async (req, res, next) => {
  try {
    const rawId = req.params.userId;
    const targetUserId = parseInt(rawId, 10);

    if (Number.isNaN(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ success: false, error: "Invalid user ID" });
    }

    // Prevent self-promotion
    if (req.user?.id === targetUserId) {
      return res.status(400).json({ success: false, error: "Self-promotion is not permitted" });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    if (targetUser.deleted) {
      return res.status(400).json({ success: false, error: "Cannot promote a deleted user account" });
    }

    // Cannot modify a SuperAdmin
    if (targetUser.role === ROLES.SUPER_ADMIN) {
      return res.status(400).json({
        success: false,
        error: "Target user is already a SuperAdmin and cannot be modified through this endpoint",
      });
    }

    // Idempotent: already an Admin
    if (targetUser.role === ROLES.ADMIN) {
      return res.status(200).json({
        success: true,
        message: "User is already an Admin",
        user: formatUserResponse(targetUser),
      });
    }

    // Unsupported role transition check
    if (targetUser.role !== ROLES.USER) {
      return res.status(400).json({
        success: false,
        error: `Unsupported role transition from '${targetUser.role}' to '${ROLES.ADMIN}'`,
      });
    }

    // Atomically update role and record audit log
    const [updatedUser] = await prisma.$transaction([
      prisma.user.update({
        where: { id: targetUserId },
        data: { role: ROLES.ADMIN },
      }),
      prisma.roleAuditLog.create({
        data: {
          actorId: req.user.id,
          targetId: targetUserId,
          action: "PROMOTE_TO_ADMIN",
          oldRole: targetUser.role,
          newRole: ROLES.ADMIN,
          ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
          userAgent: req.headers["user-agent"] || null,
        },
      }),
    ]);

    console.log(
      `[AUDIT] User ${targetUserId} (${targetUser.email}) promoted to Admin by SuperAdmin ${req.user.id} (${req.user.email}) at ${new Date().toISOString()}`
    );

    return res.status(200).json({
      success: true,
      message: "User promoted to Admin successfully",
      user: formatUserResponse(updatedUser),
    });
  } catch (error) {
    console.error("[promoteUserToAdmin] Error:", error);
    next(error);
  }
};

/**
 * POST /admin/users/:userId/demote
 * SuperAdmin-only endpoint to demote an existing Admin to User.
 * Invalidates all active sessions and sockets to prevent stale privilege retention.
 */
export const demoteAdminToUser = async (req, res, next) => {
  try {
    const rawId = req.params.userId;
    const targetUserId = parseInt(rawId, 10);

    if (Number.isNaN(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ success: false, error: "Invalid user ID" });
    }

    // Prevent self-demotion
    if (req.user?.id === targetUserId) {
      return res.status(400).json({ success: false, error: "Self-demotion is not permitted" });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    if (targetUser.deleted) {
      return res.status(400).json({ success: false, error: "Cannot demote a deleted user account" });
    }

    // SuperAdmin cannot be demoted via ordinary admin endpoints
    if (targetUser.role === ROLES.SUPER_ADMIN) {
      return res.status(403).json({
        success: false,
        error: "SuperAdmin accounts cannot be demoted through ordinary admin-management endpoints",
      });
    }

    // Idempotent: already a User
    if (targetUser.role === ROLES.USER) {
      return res.status(200).json({
        success: true,
        message: "User is already a regular User",
        user: formatUserResponse(targetUser),
      });
    }

    // Unsupported role transition check
    if (targetUser.role !== ROLES.ADMIN) {
      return res.status(400).json({
        success: false,
        error: `Unsupported role transition from '${targetUser.role}' to '${ROLES.USER}'`,
      });
    }

    // Atomically demote role, purge all existing sessions (preventing stale token/session privilege), and audit log
    const [updatedUser] = await prisma.$transaction([
      prisma.user.update({
        where: { id: targetUserId },
        data: { role: ROLES.USER },
      }),
      prisma.session.deleteMany({
        where: { userId: targetUserId },
      }),
      prisma.roleAuditLog.create({
        data: {
          actorId: req.user.id,
          targetId: targetUserId,
          action: "DEMOTE_TO_USER",
          oldRole: targetUser.role,
          newRole: ROLES.USER,
          ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
          userAgent: req.headers["user-agent"] || null,
        },
      }),
    ]);

    // Force disconnect active sockets for the demoted user
    const io = req.app.get("io");
    if (io) {
      try {
        io.in(`user:${targetUserId}`).disconnectSockets(true);
      } catch (sockErr) {
        console.warn(`[demoteAdminToUser] Could not disconnect sockets for user ${targetUserId}:`, sockErr.message);
      }
    }

    console.log(
      `[AUDIT] Admin ${targetUserId} (${targetUser.email}) demoted to User by SuperAdmin ${req.user.id} (${req.user.email}). Sessions revoked at ${new Date().toISOString()}`
    );

    return res.status(200).json({
      success: true,
      message: "Admin successfully demoted to User and sessions invalidated",
      user: formatUserResponse(updatedUser),
    });
  } catch (error) {
    console.error("[demoteAdminToUser] Error:", error);
    next(error);
  }
};

/**
 * PATCH /admin/users/:userId/role
 * PUT /admin/users/:userId/role
 * RESTful role modification endpoint. Supports setting role to "Admin" or "User".
 * SuperAdmin assignment via this endpoint is strictly rejected.
 */
export const updateUserRole = async (req, res, next) => {
  try {
    const rawId = req.params.userId;
    const targetUserId = parseInt(rawId, 10);

    if (Number.isNaN(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ success: false, error: "Invalid user ID" });
    }

    const { role } = req.body || {};
    if (!role || typeof role !== "string") {
      return res.status(400).json({
        success: false,
        error: "Role is required in request body and must be a string",
      });
    }

    const normalizedRole = role.trim();

    // Check if client is trying to assign SuperAdmin
    if (
      normalizedRole.toLowerCase() === "superadmin" ||
      normalizedRole.toLowerCase() === "super_admin" ||
      normalizedRole === ROLES.SUPER_ADMIN
    ) {
      return res.status(403).json({
        success: false,
        error: "SuperAdmin role cannot be assigned through ordinary management APIs. Use explicit server provisioning.",
      });
    }

    if (normalizedRole.toLowerCase() === "admin") {
      req.params.userId = targetUserId.toString();
      return promoteUserToAdmin(req, res, next);
    } else if (normalizedRole.toLowerCase() === "user") {
      req.params.userId = targetUserId.toString();
      return demoteAdminToUser(req, res, next);
    } else {
      return res.status(400).json({
        success: false,
        error: `Invalid role '${role}'. Supported roles for assignment are 'Admin' and 'User'`,
      });
    }
  } catch (error) {
    console.error("[updateUserRole] Error:", error);
    next(error);
  }
};

/**
 * GET /admin/users/:userId/role
 * Retrieves a user's role and status. Accessible by SuperAdmin and Admin.
 */
export const getUserRole = async (req, res, next) => {
  try {
    const rawId = req.params.userId;
    const targetUserId = parseInt(rawId, 10);

    if (Number.isNaN(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ success: false, error: "Invalid user ID" });
    }

    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        deleted: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    return res.status(200).json({
      success: true,
      data: {
        userId: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        deleted: user.deleted,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("[getUserRole] Error:", error);
    next(error);
  }
};

/**
 * GET /admin/audit-logs
 * GET /admin/users/audit-logs
 * SuperAdmin endpoint to inspect role change history and actor telemetry.
 */
export const getRoleAuditLogs = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.roleAuditLog.findMany({
        include: {
          actor: { select: { id: true, name: true, email: true, role: true } },
          target: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.roleAuditLog.count(),
    ]);

    const totalPages = Math.ceil(total / limit) || 0;

    return res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("[getRoleAuditLogs] Error:", error);
    next(error);
  }
};

