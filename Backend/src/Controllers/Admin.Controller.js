import { prisma } from "../config/db.prismaSQL.js";
import { Prisma } from "@prisma/client";
import net from "node:net";
import dns from "node:dns/promises";
import { performance } from "node:perf_hooks";
import {
  createUptimeScheduler,
  updateUptimeScheduler,
  removeUptimeScheduler,
} from "../Services/uptimeScheduler.Service.js";
import { checkUrl } from "../Services/uptimeChecker.Service.js";
import {
  RUNNERS,
  clearRunnerCache,
  getActiveRunner,
  ensureDefaultRunner,
} from "../Services/runners/index.js";

// Re-export existing user admin operations for unified controller access
export { getAllUsers, adminPowerlogout, DeleteUser } from "./User.Controller.js";
export {
  promoteUserToAdmin,
  demoteAdminToUser,
  updateUserRole,
  getUserRole,
  getRoleAuditLogs,
} from "./AdminRole.Controller.js";

const ALLOWED_INTERVALS = new Set(["1m", "5m", "10m", "15m", "30m", "1h", "m1", "m5", "m10", "m15", "m30", "h1"]);
const ALLOWED_STATUSES = new Set(["active", "paused"]);

const INTERVAL_TO_PRISMA = {
  "1m": "m1",
  "5m": "m5",
  "10m": "m10",
  "15m": "m15",
  "30m": "m30",
  "1h": "h1",
  m1: "m1",
  m5: "m5",
  m10: "m10",
  m15: "m15",
  m30: "m30",
  h1: "h1",
};

const PRISMA_TO_INTERVAL = {
  m1: "1m",
  m5: "5m",
  m10: "10m",
  m15: "15m",
  m30: "30m",
  h1: "1h",
  "1m": "1m",
  "5m": "5m",
  "10m": "10m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
};

const toPrismaInterval = (val) => INTERVAL_TO_PRISMA[val] || "m5";
const fromPrismaInterval = (val) => PRISMA_TO_INTERVAL[val] || val;

const formatAdminMonitor = (m) => {
  if (!m) return null;
  const { user, ...rest } = m;
  return {
    ...rest,
    id: m.id,
    _id: m.id,
    interval: fromPrismaInterval(m.interval),
    userId: user ? { ...user, _id: user.id } : m.userId,
    runnerId: m.runnerId ?? null,
    runner: m.runner
      ? {
          id: m.runner.id,
          name: m.runner.name,
          type: m.runner.type,
          isActive: m.runner.isActive,
          isDefault: m.runner.isDefault,
        }
      : null,
  };
};

const formatResult = (r) => {
  if (!r) return null;
  return {
    ...r,
    id: r.id.toString(),
    _id: r.id.toString(),
  };
};

/**
 * GET /admin/monitors/stats
 * GET /admin/monitors/total
 * Check total monitors, active vs paused, health status breakdown, intervals, and user metrics.
 */
export const adminGetMonitorStats = async (req, res) => {
  try {
    const [
      totalMonitors,
      activeMonitors,
      pausedMonitors,
      upMonitors,
      downMonitors,
      pendingMonitors,
      distinctUsers,
      totalResultRecords,
      intervalGroups,
    ] = await Promise.all([
      prisma.uptimeMonitor.count(),
      prisma.uptimeMonitor.count({ where: { status: "active" } }),
      prisma.uptimeMonitor.count({ where: { status: "paused" } }),
      prisma.uptimeMonitor.count({
        where: {
          lastResult: {
            path: ["status"],
            equals: "UP",
          },
        },
      }),
      prisma.uptimeMonitor.count({
        where: {
          lastResult: {
            path: ["status"],
            equals: "DOWN",
          },
        },
      }),
      prisma.uptimeMonitor.count({
        where: {
          lastResult: {
            equals: Prisma.AnyNull,
          },
        },
      }),
      prisma.uptimeMonitor.groupBy({
        by: ["userId"],
      }),
      prisma.uptimeResult.count(),
      prisma.uptimeMonitor.groupBy({
        by: ["interval"],
        _count: { _all: true },
      }),
    ]);

    const intervalBreakdown = {
      "1m": 0,
      "5m": 0,
      "15m": 0,
      "30m": 0,
      "1h": 0,
    };

    intervalGroups.forEach((item) => {
      const standardKey = fromPrismaInterval(item.interval);
      if (standardKey && intervalBreakdown.hasOwnProperty(standardKey)) {
        intervalBreakdown[standardKey] = item._count._all;
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        totalMonitors,
        activeMonitors,
        pausedMonitors,
        health: {
          up: upMonitors,
          down: downMonitors,
          pending: pendingMonitors,
        },
        intervalBreakdown,
        totalUsersWithMonitors: distinctUsers.length,
        totalChecksRecorded: totalResultRecords,
      },
    });
  } catch (error) {
    console.error("[adminGetMonitorStats] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while fetching monitor statistics",
      details: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Alias for adminGetMonitorStats to directly satisfy "check total monitor" requests
 */
export const adminGetTotalMonitors = adminGetMonitorStats;

/**
 * GET /admin/monitors
 * Fetch all monitors across all users with pagination, status filter, user filter, and search.
 */
export const adminGetAllMonitors = async (req, res) => {
  try {
    const {
      status,
      userId,
      interval,
      runnerId,
      search,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      order = "desc",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    if (status && ALLOWED_STATUSES.has(status)) {
      where.status = status;
    }

    if (userId) {
      const parsedUserId = parseInt(userId, 10);
      if (Number.isNaN(parsedUserId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid userId format",
        });
      }
      where.userId = parsedUserId;
    }

    if (interval && ALLOWED_INTERVALS.has(interval)) {
      where.interval = toPrismaInterval(interval);
    }

    if (runnerId !== undefined && runnerId !== "") {
      if (runnerId === "default" || runnerId === "null") {
        where.runnerId = null;
      } else {
        const parsedRunnerId = parseInt(runnerId, 10);
        if (!Number.isNaN(parsedRunnerId)) {
          where.runnerId = parsedRunnerId;
        }
      }
    }

    if (search && typeof search === "string" && search.trim()) {
      where.url = { contains: search.trim(), mode: "insensitive" };
    }

    const sortOrder = order.toLowerCase() === "asc" ? "asc" : "desc";
    const allowedSortFields = ["createdAt", "updatedAt", "lastCheckedAt", "url", "status", "interval", "runnerId"];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";

    const [monitors, total] = await Promise.all([
      prisma.uptimeMonitor.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true, deleted: true, picture: true },
          },
          runner: {
            select: { id: true, name: true, type: true, isActive: true, isDefault: true },
          },
        },
        orderBy: { [sortField]: sortOrder },
        skip,
        take: limitNum,
      }),
      prisma.uptimeMonitor.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    return res.status(200).json({
      success: true,
      data: monitors.map(formatAdminMonitor),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (error) {
    console.error("[adminGetAllMonitors] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while fetching all monitors",
      details: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * GET /admin/monitors/:id
 * Fetch details of a single monitor across any user, including recent check results and owner details.
 */
export const adminGetMonitorDetails = async (req, res) => {
  try {
    const monitorId = parseInt(req.params.id, 10);

    if (Number.isNaN(monitorId)) {
      return res.status(400).json({ success: false, error: "Invalid monitor ID format" });
    }

    const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const skip = (pageNum - 1) * limitNum;

    const [monitor, totalChecksCount] = await Promise.all([
      prisma.uptimeMonitor.findUnique({
        where: { id: monitorId },
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true, deleted: true, picture: true },
          },
        },
      }),
      prisma.uptimeResult.count({ where: { monitorId } }),
    ]);

    if (!monitor) {
      return res.status(404).json({ success: false, error: "Monitor not found" });
    }

    const recentResults = await prisma.uptimeResult.findMany({
      where: { monitorId },
      orderBy: { checkedAt: "desc" },
      skip,
      take: limitNum,
      select: { id: true, monitorId: true, userId: true, result: true, checkedAt: true },
    });

    const totalPages = Math.ceil(totalChecksCount / limitNum);

    return res.status(200).json({
      success: true,
      data: {
        monitor: formatAdminMonitor(monitor),
        recentResults: recentResults.map(formatResult),
        totalChecksCount,
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalChecksCount,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (error) {
    console.error("[adminGetMonitorDetails] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while fetching monitor details",
    });
  }
};

/**
 * PATCH or POST /admin/monitors/:id/pause
 * Admin pauses any monitor, removing background scheduler job and notifying the owner.
 */
export const adminPauseMonitor = async (req, res) => {
  try {
    const { id } = req.params;
    const monitorId = parseInt(id, 10);

    if (Number.isNaN(monitorId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid monitor ID format",
      });
    }

    const monitor = await prisma.uptimeMonitor.findUnique({
      where: { id: monitorId },
    });

    if (!monitor) {
      return res.status(404).json({
        success: false,
        error: "Monitor not found",
      });
    }

    if (monitor.status === "paused") {
      return res.status(200).json({
        success: true,
        message: "Monitor is already paused",
        monitor: formatAdminMonitor(monitor),
      });
    }

    const ownerRoomId = monitor.userId ? `user:${monitor.userId}` : null;

    try {
      await removeUptimeScheduler(monitor.id, ownerRoomId);
    } catch (schedErr) {
      console.warn(`[adminPauseMonitor] Scheduler removal warning for ${id}:`, schedErr.message);
    }

    const updated = await prisma.uptimeMonitor.update({
      where: { id: monitorId },
      data: { status: "paused" },
    });

    // Notify the monitor owner via socket if online
    const io = req.app.get("io");
    if (io && ownerRoomId) {
      io.to(ownerRoomId).emit("monitor:statusChange", {
        monitorId: monitor.id.toString(),
        status: "paused",
        action: "paused_by_admin",
        changedAt: new Date(),
      });
    }

    return res.status(200).json({
      success: true,
      message: "Monitor paused by admin successfully",
      monitor: formatAdminMonitor(updated),
    });
  } catch (error) {
    console.error("[adminPauseMonitor] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while pausing monitor",
    });
  }
};

/**
 * PATCH or POST /admin/monitors/:id/resume
 * PATCH or POST /admin/monitors/:id/activate
 * Admin resumes/activates any monitor, starting background scheduler job with rollback safety.
 */
export const adminResumeMonitor = async (req, res) => {
  try {
    const { id } = req.params;
    const monitorId = parseInt(id, 10);

    if (Number.isNaN(monitorId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid monitor ID format",
      });
    }

    const monitor = await prisma.uptimeMonitor.findUnique({
      where: { id: monitorId },
    });

    if (!monitor) {
      return res.status(404).json({
        success: false,
        error: "Monitor not found",
      });
    }

    // Verify owner account is active
    if (monitor.userId) {
      const owner = await prisma.user.findUnique({
        where: { id: monitor.userId },
        select: { id: true, deleted: true },
      });
      if (!owner || owner.deleted) {
        return res.status(400).json({
          success: false,
          error: "Cannot activate monitor for a deleted or nonexistent user account",
        });
      }
    }

    if (monitor.status === "active") {
      return res.status(200).json({
        success: true,
        message: "Monitor is already active",
        monitor: formatAdminMonitor(monitor),
      });
    }

    const previousStatus = monitor.status;
    const updated = await prisma.uptimeMonitor.update({
      where: { id: monitorId },
      data: { status: "active" },
    });

    const ownerRoomId = monitor.userId ? `user:${monitor.userId}` : null;
    const formattedUpdated = formatAdminMonitor(updated);

    try {
      await createUptimeScheduler(formattedUpdated, ownerRoomId);
    } catch (schedErr) {
      console.error(`[adminResumeMonitor] Scheduler creation failed for ${id}:`, schedErr);
      await prisma.uptimeMonitor.update({
        where: { id: monitorId },
        data: { status: previousStatus },
      }).catch(() => {});

      return res.status(500).json({
        success: false,
        error: "Failed to initialize scheduler in background. Monitor remains paused.",
      });
    }

    // Notify the monitor owner via socket if online
    const io = req.app.get("io");
    if (io && ownerRoomId) {
      io.to(ownerRoomId).emit("monitor:statusChange", {
        monitorId: monitor.id.toString(),
        status: "active",
        action: "activated_by_admin",
        changedAt: new Date(),
      });
    }

    return res.status(200).json({
      success: true,
      message: "Monitor activated successfully by admin",
      monitor: formattedUpdated,
    });
  } catch (error) {
    console.error("[adminResumeMonitor] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while activating monitor",
    });
  }
};

/**
 * Alias for adminResumeMonitor to explicitly support activate endpoint
 */
export const adminActivateMonitor = adminResumeMonitor;

/**
 * DELETE or POST /admin/monitors/:id
 * DELETE or POST /admin/monitors/:id/delete
 * Admin deletes a specific monitor, stops its scheduler, and cleans up historical results.
 */
export const adminDeleteMonitor = async (req, res) => {
  try {
    const { id } = req.params;
    const monitorId = parseInt(id, 10);

    if (Number.isNaN(monitorId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid monitor ID format",
      });
    }

    const monitor = await prisma.uptimeMonitor.findUnique({
      where: { id: monitorId },
    });

    if (!monitor) {
      return res.status(404).json({
        success: false,
        error: "Monitor not found",
      });
    }

    const ownerRoomId = monitor.userId ? `user:${monitor.userId}` : null;

    try {
      await removeUptimeScheduler(monitor.id, ownerRoomId);
    } catch (schedErr) {
      console.warn(`[adminDeleteMonitor] Scheduler removal warning for ${id}:`, schedErr.message);
    }

    await prisma.$transaction([
      prisma.uptimeResult.deleteMany({ where: { monitorId } }),
      prisma.uptimeMonitor.delete({ where: { id: monitorId } }),
    ]);

    const io = req.app.get("io");
    if (io && ownerRoomId) {
      io.to(ownerRoomId).emit("monitor:deleted", {
        monitorId: id,
        deletedBy: "admin",
        deletedAt: new Date(),
      });
    }

    return res.status(200).json({
      success: true,
      message: "Monitor and associated check results deleted successfully by admin",
      deletedMonitorId: id,
    });
  } catch (error) {
    console.error("[adminDeleteMonitor] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while deleting monitor",
    });
  }
};

/**
 * DELETE /admin/monitors/active
 * POST /admin/monitors/active/delete
 * Admin bulk deletes active monitors across the system, by user, or by list of monitor IDs.
 */
export const adminDeleteActiveMonitors = async (req, res) => {
  try {
    const { monitorIds, userId } = req.body || {};
    const queryUserId = req.query.userId || userId;

    const where = { status: "active" };

    if (queryUserId) {
      const parsedUserId = parseInt(queryUserId, 10);
      if (Number.isNaN(parsedUserId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid userId format",
        });
      }
      where.userId = parsedUserId;
    }

    if (Array.isArray(monitorIds) && monitorIds.length > 0) {
      const validIds = monitorIds
        .map((id) => parseInt(id, 10))
        .filter((id) => !Number.isNaN(id));

      if (validIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No valid monitor IDs provided in monitorIds array",
        });
      }
      where.id = { in: validIds };
    }

    const activeMonitors = await prisma.uptimeMonitor.findMany({ where });

    if (!activeMonitors || activeMonitors.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No active monitors matched the criteria to delete",
        count: 0,
        deletedIds: [],
      });
    }

    const io = req.app.get("io");
    const deletedIds = [];

    for (const monitor of activeMonitors) {
      const ownerRoomId = monitor.userId ? `user:${monitor.userId}` : null;

      try {
        await removeUptimeScheduler(monitor.id, ownerRoomId);
      } catch (schedErr) {
        console.warn(`[adminDeleteActiveMonitors] Failed to remove scheduler for ${monitor.id}:`, schedErr.message);
      }

      await prisma.$transaction([
        prisma.uptimeResult.deleteMany({ where: { monitorId: monitor.id } }),
        prisma.uptimeMonitor.delete({ where: { id: monitor.id } }),
      ]);

      deletedIds.push(monitor.id.toString());

      if (io && ownerRoomId) {
        io.to(ownerRoomId).emit("monitor:deleted", {
          monitorId: monitor.id.toString(),
          deletedBy: "admin",
          deletedAt: new Date(),
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Successfully deleted ${deletedIds.length} active monitor(s) and their check records`,
      count: deletedIds.length,
      deletedIds,
    });
  } catch (error) {
    console.error("[adminDeleteActiveMonitors] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while deleting active monitors",
    });
  }
};

/**
 * POST /admin/monitors/bulk/pause
 * Bulk pause monitors by array of IDs or for a specific user.
 */
export const adminBulkPauseMonitors = async (req, res) => {
  try {
    const { monitorIds, userId } = req.body || {};

    const where = { status: "active" };

    if (userId) {
      const parsedUserId = parseInt(userId, 10);
      if (Number.isNaN(parsedUserId)) {
        return res.status(400).json({ success: false, error: "Invalid userId format" });
      }
      where.userId = parsedUserId;
    }

    if (Array.isArray(monitorIds) && monitorIds.length > 0) {
      const validIds = monitorIds
        .map((id) => parseInt(id, 10))
        .filter((id) => !Number.isNaN(id));
      where.id = { in: validIds };
    }

    const monitorsToPause = await prisma.uptimeMonitor.findMany({ where });

    if (monitorsToPause.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No active monitors matched to pause",
        count: 0,
        pausedIds: [],
      });
    }

    const io = req.app.get("io");
    const pausedIds = [];

    for (const monitor of monitorsToPause) {
      const ownerRoomId = monitor.userId ? `user:${monitor.userId}` : null;
      try {
        await removeUptimeScheduler(monitor.id, ownerRoomId);
      } catch (err) {
        console.warn(`[adminBulkPauseMonitors] Failed to remove scheduler for ${monitor.id}:`, err.message);
      }

      await prisma.uptimeMonitor.update({
        where: { id: monitor.id },
        data: { status: "paused" },
      });
      pausedIds.push(monitor.id.toString());

      if (io && ownerRoomId) {
        io.to(ownerRoomId).emit("monitor:statusChange", {
          monitorId: monitor.id.toString(),
          status: "paused",
          action: "bulk_paused_by_admin",
          changedAt: new Date(),
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Successfully paused ${pausedIds.length} monitor(s)`,
      count: pausedIds.length,
      pausedIds,
    });
  } catch (error) {
    console.error("[adminBulkPauseMonitors] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while bulk pausing monitors",
    });
  }
};

/**
 * POST /admin/monitors/bulk/resume
 * Bulk resume / activate monitors by array of IDs or for a specific user.
 */
export const adminBulkResumeMonitors = async (req, res) => {
  try {
    const { monitorIds, userId } = req.body || {};

    const where = { status: "paused" };

    if (userId) {
      const parsedUserId = parseInt(userId, 10);
      if (Number.isNaN(parsedUserId)) {
        return res.status(400).json({ success: false, error: "Invalid userId format" });
      }
      where.userId = parsedUserId;
    }

    if (Array.isArray(monitorIds) && monitorIds.length > 0) {
      const validIds = monitorIds
        .map((id) => parseInt(id, 10))
        .filter((id) => !Number.isNaN(id));
      where.id = { in: validIds };
    }

    const monitorsToResume = await prisma.uptimeMonitor.findMany({ where });

    if (monitorsToResume.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No paused monitors matched to resume",
        count: 0,
        resumedIds: [],
      });
    }

    const io = req.app.get("io");
    const resumedIds = [];
    const failedIds = [];

    for (const monitor of monitorsToResume) {
      const ownerRoomId = monitor.userId ? `user:${monitor.userId}` : null;
      await prisma.uptimeMonitor.update({
        where: { id: monitor.id },
        data: { status: "active" },
      });

      const formatted = formatAdminMonitor({ ...monitor, status: "active" });

      try {
        await createUptimeScheduler(formatted, ownerRoomId);
        resumedIds.push(monitor.id.toString());

        if (io && ownerRoomId) {
          io.to(ownerRoomId).emit("monitor:statusChange", {
            monitorId: monitor.id.toString(),
            status: "active",
            action: "bulk_activated_by_admin",
            changedAt: new Date(),
          });
        }
      } catch (err) {
        console.error(`[adminBulkResumeMonitors] Failed to start scheduler for ${monitor.id}:`, err);
        await prisma.uptimeMonitor.update({
          where: { id: monitor.id },
          data: { status: "paused" },
        }).catch(() => {});
        failedIds.push(monitor.id.toString());
      }
    }

    return res.status(200).json({
      success: true,
      message: `Successfully resumed ${resumedIds.length} monitor(s)${failedIds.length ? `, failed for ${failedIds.length}` : ""}`,
      count: resumedIds.length,
      resumedIds,
      failedIds,
    });
  } catch (error) {
    console.error("[adminBulkResumeMonitors] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while bulk resuming monitors",
    });
  }
};

/**
 * POST /admin/monitors/:id/check
 * POST /uptime/admin/monitor/:id/check
 * Admin triggers an immediate ad-hoc probe check for any monitor.
 * Executes checkUrl, saves result in UptimeResult, updates UptimeMonitor, emits to socket room, and returns result.
 */
export const adminTriggerMonitorCheck = async (req, res) => {
  try {
    const { id } = req.params;
    const monitorId = parseInt(id, 10);

    if (Number.isNaN(monitorId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid monitor ID format",
      });
    }

    const monitor = await prisma.uptimeMonitor.findUnique({
      where: { id: monitorId },
    });
    if (!monitor) {
      return res.status(404).json({
        success: false,
        error: "Monitor not found",
      });
    }

    const checkedAt = new Date();
    let result;

    try {
      result = await checkUrl(monitor.url);
    } catch (checkErr) {
      result = {
        status: "DOWN",
        reason: "CHECK_ERROR",
        error: checkErr.message || "Manual check execution error",
        responseTime: null,
        ttfb: null,
      };
    }

    const isUp = Boolean(result && result.status !== "DOWN");

    // Persist result and update monitor
    const [savedResult] = await Promise.all([
      prisma.uptimeResult.create({
        data: {
          monitorId: monitor.id,
          userId: monitor.userId,
          result,
          checkedAt,
        },
      }),
      prisma.uptimeMonitor.update({
        where: { id: monitor.id },
        data: {
          lastResult: result,
          lastCheckedAt: checkedAt,
        },
      }),
    ]);

    const ownerRoomId = monitor.userId ? `user:${monitor.userId}` : null;
    const io = req.app.get("io");

    const payload = {
      jobId: `manual-admin-${Date.now()}`,
      roomId: ownerRoomId,
      monitorId: monitor.id.toString(),
      url: monitor.url,
      result,
      status: isUp ? "up" : "down",
      triggeredBy: "admin",
      checkedAt,
    };

    if (io && ownerRoomId) {
      io.to(ownerRoomId).emit("uptime:result", payload);
      io.to(ownerRoomId).emit("uptimeCompleted", payload);
    }

    return res.status(200).json({
      success: true,
      message: "Ad-hoc monitor check executed successfully",
      monitorId: monitor.id.toString(),
      result,
      status: isUp ? "UP" : "DOWN",
      checkedAt,
      resultRecordId: savedResult.id.toString(),
    });
  } catch (error) {
    console.error("[adminTriggerMonitorCheck] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while executing ad-hoc monitor check",
    });
  }
};

/**
 * POST /admin/monitors
 * POST /uptime/admin/create
 * Admin provisions a new monitor for any designated user or themselves.
 */
export const adminCreateMonitor = async (req, res) => {
  try {
    const { url, interval = "5m", userId, runnerId } = req.body || {};

    if (!url || typeof url !== "string") {
      return res.status(400).json({ success: false, error: "Target URL is required" });
    }

    try {
      new URL(url.trim());
    } catch {
      return res.status(400).json({ success: false, error: "Invalid URL format. Include http:// or https://" });
    }

    if (!ALLOWED_INTERVALS.has(interval)) {
      return res.status(400).json({
        success: false,
        error: `Invalid interval. Allowed values are: 1m, 5m, 15m, 30m, 1h`,
      });
    }

    const rawTargetUserId = userId || req.user._id || req.user.id;
    const targetUserId = parseInt(rawTargetUserId, 10);

    if (Number.isNaN(targetUserId)) {
      return res.status(400).json({ success: false, error: "Invalid userId format" });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, deleted: true },
    });
    if (!targetUser || targetUser.deleted) {
      return res.status(404).json({ success: false, error: "Target user account not found or deleted" });
    }

    let assignedRunnerId = null;
    if (runnerId !== undefined && runnerId !== null && runnerId !== "" && runnerId !== "default") {
      const parsedRunnerId = parseInt(runnerId, 10);
      if (Number.isNaN(parsedRunnerId)) {
        return res.status(400).json({ success: false, error: "Invalid runnerId format" });
      }
      const runner = await prisma.uptimeRunner.findUnique({ where: { id: parsedRunnerId } });
      if (!runner) {
        return res.status(404).json({ success: false, error: `Runner #${parsedRunnerId} not found` });
      }
      if (!runner.isActive) {
        return res.status(400).json({
          success: false,
          error: `Runner '${runner.name}' is disabled and cannot be assigned`,
        });
      }
      assignedRunnerId = parsedRunnerId;
    }

    // Check duplicate
    const existing = await prisma.uptimeMonitor.findUnique({
      where: {
        userId_url: {
          userId: targetUserId,
          url: url.trim(),
        },
      },
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        error: "A monitor for this URL already exists for the designated user",
      });
    }

    const monitor = await prisma.uptimeMonitor.create({
      data: {
        url: url.trim(),
        interval: toPrismaInterval(interval),
        status: "active",
        userId: targetUserId,
        runnerId: assignedRunnerId,
      },
      include: {
        runner: {
          select: { id: true, name: true, type: true, isActive: true, isDefault: true },
        },
      },
    });

    const ownerRoomId = `user:${targetUserId}`;
    const formatted = formatAdminMonitor(monitor);

    try {
      await createUptimeScheduler(formatted, ownerRoomId);
    } catch (schedErr) {
      await prisma.uptimeMonitor.delete({ where: { id: monitor.id } }).catch(() => {});
      console.error("[adminCreateMonitor] Scheduler initialization failed:", schedErr);
      return res.status(500).json({
        success: false,
        error: "Failed to initialize the background scheduler for new monitor",
      });
    }

    const io = req.app.get("io");
    if (io && ownerRoomId) {
      io.to(ownerRoomId).emit("monitor:created", {
        monitorId: monitor.id.toString(),
        url: monitor.url,
        interval: fromPrismaInterval(monitor.interval),
        status: monitor.status,
        createdBy: "admin",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Monitor created successfully by admin",
      monitor: formatted,
    });
  } catch (error) {
    console.error("[adminCreateMonitor] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while creating monitor",
    });
  }
};

/**
 * PUT or PATCH /admin/monitors/:id
 * PUT or PATCH /uptime/admin/update/:id
 * Admin updates configuration (url, interval, status) of any monitor.
 */
export const adminUpdateMonitor = async (req, res) => {
  try {
    const { id } = req.params;
    const { url, interval, status, runnerId } = req.body || {};
    const monitorId = parseInt(id, 10);

    if (Number.isNaN(monitorId)) {
      return res.status(400).json({ success: false, error: "Invalid monitor ID format" });
    }

    const monitor = await prisma.uptimeMonitor.findUnique({
      where: { id: monitorId },
    });
    if (!monitor) {
      return res.status(404).json({ success: false, error: "Monitor not found" });
    }

    const updates = {};

    if (url !== undefined) {
      try {
        new URL(url.trim());
        updates.url = url.trim();
      } catch {
        return res.status(400).json({ success: false, error: "Invalid URL format" });
      }
    }

    if (interval !== undefined) {
      if (!ALLOWED_INTERVALS.has(interval)) {
        return res.status(400).json({
          success: false,
          error: `Invalid interval. Allowed values are: 1m, 5m, 15m, 30m, 1h`,
        });
      }
      updates.interval = toPrismaInterval(interval);
    }

    if (status !== undefined) {
      if (!ALLOWED_STATUSES.has(status)) {
        return res.status(400).json({ success: false, error: "Invalid status. Must be 'active' or 'paused'" });
      }
      updates.status = status;
    }

    if (runnerId !== undefined) {
      if (runnerId === null || runnerId === "" || runnerId === "default") {
        updates.runnerId = null;
      } else {
        const parsedRunnerId = parseInt(runnerId, 10);
        if (Number.isNaN(parsedRunnerId)) {
          return res.status(400).json({ success: false, error: "Invalid runnerId format" });
        }
        const runner = await prisma.uptimeRunner.findUnique({ where: { id: parsedRunnerId } });
        if (!runner) {
          return res.status(404).json({ success: false, error: `Runner #${parsedRunnerId} not found` });
        }
        if (!runner.isActive) {
          return res.status(400).json({
            success: false,
            error: `Runner '${runner.name}' is disabled and cannot be assigned`,
          });
        }
        updates.runnerId = parsedRunnerId;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: "No fields to update provided" });
    }

    const prevStatus = monitor.status;
    const prevInterval = monitor.interval;

    const updated = await prisma.uptimeMonitor.update({
      where: { id: monitorId },
      data: updates,
    });

    const ownerRoomId = monitor.userId ? `user:${monitor.userId}` : null;
    const formatted = formatAdminMonitor(updated);

    try {
      if (updated.status === "active") {
        if (prevStatus === "paused" || prevInterval !== updated.interval) {
          await updateUptimeScheduler(formatted, ownerRoomId);
        }
      } else if (updated.status === "paused") {
        await removeUptimeScheduler(updated.id, ownerRoomId);
      }
    } catch (schedErr) {
      console.warn(`[adminUpdateMonitor] Scheduler sync warning for ${id}:`, schedErr.message);
    }

    const io = req.app.get("io");
    if (io && ownerRoomId) {
      io.to(ownerRoomId).emit("monitor:statusChange", {
        monitorId: updated.id.toString(),
        status: updated.status,
        url: updated.url,
        interval: fromPrismaInterval(updated.interval),
        action: "updated_by_admin",
        changedAt: new Date(),
      });
    }

    return res.status(200).json({
      success: true,
      message: "Monitor updated successfully by admin",
      monitor: formatted,
    });
  } catch (error) {
    console.error("[adminUpdateMonitor] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while updating monitor",
    });
  }
};

/**
 * POST /admin/monitors/bulk/delete
 * DELETE /admin/monitors/bulk
 * POST /uptime/admin/bulk/delete
 * Admin deletes ANY selection of monitors (active or paused) or all monitors for a user.
 */
export const adminBulkDeleteMonitors = async (req, res) => {
  try {
    const { monitorIds, userId } = req.body || {};
    const queryUserId = req.query.userId || userId;

    const where = {};

    if (queryUserId) {
      const parsedUserId = parseInt(queryUserId, 10);
      if (Number.isNaN(parsedUserId)) {
        return res.status(400).json({ success: false, error: "Invalid userId format" });
      }
      where.userId = parsedUserId;
    }

    if (Array.isArray(monitorIds) && monitorIds.length > 0) {
      const validIds = monitorIds
        .map((id) => parseInt(id, 10))
        .filter((id) => !Number.isNaN(id));

      if (validIds.length === 0) {
        return res.status(400).json({ success: false, error: "No valid monitor IDs provided in monitorIds array" });
      }
      where.id = { in: validIds };
    }

    if (Object.keys(where).length === 0) {
      return res.status(400).json({
        success: false,
        error: "Either monitorIds array or userId must be provided for bulk deletion",
      });
    }

    const targets = await prisma.uptimeMonitor.findMany({ where });
    if (!targets || targets.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No monitors matched the deletion criteria",
        count: 0,
        deletedIds: [],
      });
    }

    const io = req.app.get("io");
    const deletedIds = [];

    for (const monitor of targets) {
      const ownerRoomId = monitor.userId ? `user:${monitor.userId}` : null;

      try {
        await removeUptimeScheduler(monitor.id, ownerRoomId);
      } catch (schedErr) {
        console.warn(`[adminBulkDeleteMonitors] Scheduler removal error for ${monitor.id}:`, schedErr.message);
      }

      await prisma.$transaction([
        prisma.uptimeResult.deleteMany({ where: { monitorId: monitor.id } }),
        prisma.uptimeMonitor.delete({ where: { id: monitor.id } }),
      ]);

      deletedIds.push(monitor.id.toString());

      if (io && ownerRoomId) {
        io.to(ownerRoomId).emit("monitor:deleted", {
          monitorId: monitor.id.toString(),
          deletedBy: "admin",
          deletedAt: new Date(),
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Successfully deleted ${deletedIds.length} monitor(s) and their probe history`,
      count: deletedIds.length,
      deletedIds,
    });
  } catch (error) {
    console.error("[adminBulkDeleteMonitors] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while bulk deleting monitors",
    });
  }
};

/**
 * DELETE /admin/monitors/:id/results
 * POST /admin/monitors/:id/results/clear
 * DELETE /uptime/admin/monitor/:id/results
 * Admin cleans probe history for a specific monitor without removing the monitor itself.
 * Optional query or body param: olderThanDays (number)
 */
export const adminClearMonitorResults = async (req, res) => {
  try {
    const { id } = req.params;
    const olderThanDays = req.body?.olderThanDays ?? req.query?.olderThanDays;
    const monitorId = parseInt(id, 10);

    if (Number.isNaN(monitorId)) {
      return res.status(400).json({ success: false, error: "Invalid monitor ID format" });
    }

    const monitor = await prisma.uptimeMonitor.findUnique({
      where: { id: monitorId },
    });
    if (!monitor) {
      return res.status(404).json({ success: false, error: "Monitor not found" });
    }

    const deleteWhere = { monitorId };

    if (olderThanDays !== undefined && olderThanDays !== null && !isNaN(Number(olderThanDays))) {
      const cutoff = new Date(Date.now() - Math.max(0, Number(olderThanDays)) * 86400000);
      deleteWhere.checkedAt = { lt: cutoff };
    }

    const result = await prisma.uptimeResult.deleteMany({ where: deleteWhere });

    // If all results cleared, reset monitor lastResult / lastCheckedAt
    if (!olderThanDays) {
      await prisma.uptimeMonitor.update({
        where: { id: monitorId },
        data: { lastResult: Prisma.DbNull, lastCheckedAt: null },
      });
    }

    return res.status(200).json({
      success: true,
      message: `Successfully purged ${result.count} check result records`,
      deletedCount: result.count,
      monitorId: id,
    });
  } catch (error) {
    console.error("[adminClearMonitorResults] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while clearing monitor results history",
    });
  }
};

/**
 * POST /admin/monitors/bulk/interval
 * POST /uptime/admin/bulk/interval
 * Admin mass-updates check interval for a set of monitors or a user's monitors.
 */
export const adminBulkUpdateInterval = async (req, res) => {
  try {
    const { monitorIds, userId, interval } = req.body || {};

    if (!interval || !ALLOWED_INTERVALS.has(interval)) {
      return res.status(400).json({
        success: false,
        error: `Invalid interval. Allowed values are: 1m, 5m, 15m, 30m, 1h`,
      });
    }

    const where = {};

    if (userId) {
      const parsedUserId = parseInt(userId, 10);
      if (Number.isNaN(parsedUserId)) {
        return res.status(400).json({ success: false, error: "Invalid userId format" });
      }
      where.userId = parsedUserId;
    }

    if (Array.isArray(monitorIds) && monitorIds.length > 0) {
      const validIds = monitorIds
        .map((id) => parseInt(id, 10))
        .filter((id) => !Number.isNaN(id));
      where.id = { in: validIds };
    }

    if (Object.keys(where).length === 0) {
      return res.status(400).json({
        success: false,
        error: "Either monitorIds array or userId must be specified",
      });
    }

    const monitors = await prisma.uptimeMonitor.findMany({ where });
    if (!monitors || monitors.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No monitors found to update",
        count: 0,
        updatedIds: [],
      });
    }

    const updatedIds = [];
    const io = req.app.get("io");
    const prismaInterval = toPrismaInterval(interval);

    for (const mon of monitors) {
      const updated = await prisma.uptimeMonitor.update({
        where: { id: mon.id },
        data: { interval: prismaInterval },
      });
      updatedIds.push(mon.id.toString());

      const ownerRoomId = mon.userId ? `user:${mon.userId}` : null;
      const formatted = formatAdminMonitor(updated);

      if (mon.status === "active") {
        try {
          await updateUptimeScheduler(formatted, ownerRoomId);
        } catch (err) {
          console.warn(`[adminBulkUpdateInterval] Scheduler error for ${mon.id}:`, err.message);
        }
      }

      if (io && ownerRoomId) {
        io.to(ownerRoomId).emit("monitor:statusChange", {
          monitorId: mon.id.toString(),
          interval: fromPrismaInterval(updated.interval),
          status: mon.status,
          action: "interval_updated_by_admin",
          changedAt: new Date(),
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Successfully changed interval to ${interval} for ${updatedIds.length} monitor(s)`,
      count: updatedIds.length,
      updatedIds,
      interval,
    });
  } catch (error) {
    console.error("[adminBulkUpdateInterval] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while updating monitor intervals",
    });
  }
};

/**
 * GET /admin/monitors/incidents
 * GET /uptime/admin/incidents
 * Admin fetches all monitors currently encountering DOWN or degraded status across the system.
 */
export const adminGetMonitorIncidents = async (req, res) => {
  try {
    const incidents = await prisma.uptimeMonitor.findMany({
      where: {
        OR: [
          { lastResult: { path: ["status"], equals: "DOWN" } },
          { lastResult: { path: ["status"], equals: "DEGRADED" } },
        ],
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, picture: true },
        },
      },
      orderBy: { lastCheckedAt: "desc" },
    });

    return res.status(200).json({
      success: true,
      count: incidents.length,
      incidents: incidents.map(formatAdminMonitor),
    });
  } catch (error) {
    console.error("[adminGetMonitorIncidents] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while fetching monitor incidents",
    });
  }
};

/**
 * GET /admin/monitors/export
 * GET /uptime/admin/export
 * Admin exports all monitors with user and health telemetry.
 */
export const adminExportMonitors = async (req, res) => {
  try {
    const monitors = await prisma.uptimeMonitor.findMany({
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const formatted = monitors.map((m) => ({
      id: m.id.toString(),
      url: m.url,
      interval: fromPrismaInterval(m.interval),
      status: m.status,
      health: m.lastResult?.status || "PENDING",
      responseTimeMs: m.lastResult?.responseTime ?? null,
      httpStatus: m.lastResult?.httpStatus ?? null,
      lastCheckedAt: m.lastCheckedAt ? new Date(m.lastCheckedAt).toISOString() : null,
      createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : null,
      userEmail: m.user?.email || "Unknown",
      userName: m.user?.name || "Unknown",
      userRole: m.user?.role || "User",
    }));

    return res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (error) {
    console.error("[adminExportMonitors] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while exporting monitor records",
    });
  }
};

// ==============================================================================
// UPTIME RUNNER MANAGEMENT (ADMIN / SUPERADMIN RBAC)
// ==============================================================================

const isPrivateOrInternalIp = (ip) => {
  const bl = new net.BlockList();
  [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.168.0.0/16",
  ].forEach((cidr) => {
    const [addr, prefix] = cidr.split("/");
    bl.addSubnet(addr, Number(prefix), "ipv4");
  });
  bl.addAddress("::1", "ipv6");
  bl.addSubnet("fc00::", 7, "ipv6");
  bl.addSubnet("fe80::", 10, "ipv6");
  return bl.check(ip, net.isIPv6(ip) ? "ipv6" : "ipv4");
};

/**
 * Validates an HTTP runner URL:
 * - Must be valid URL format
 * - Must use HTTPS
 * - Blocks localhost, internal domains, and private/internal IPs (SSRF protection)
 */
export const validateHttpRunnerTarget = async (urlString) => {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, error: "HTTP runner URL must use HTTPS" };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan")
  ) {
    return { valid: false, error: "Private and internal hostnames are blocked (SSRF protection)" };
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrInternalIp(hostname)) {
      return { valid: false, error: "Private and reserved IP addresses are blocked (SSRF protection)" };
    }
  } else {
    try {
      const addresses = await dns.resolve(hostname);
      for (const addr of addresses) {
        if (isPrivateOrInternalIp(addr)) {
          return {
            valid: false,
            error: `Resolved IP (${addr}) for host '${hostname}' is private/internal (SSRF protection)`,
          };
        }
      }
    } catch (err) {
      return { valid: false, error: `Could not resolve hostname '${hostname}': ${err.message}` };
    }
  }

  return { valid: true, url: parsed.href };
};

/**
 * GET /admin/runners
 * Fetches all registered uptime runners with monitor count and defaultMonitorCount.
 * Masked/sanitized configuration so secrets are never returned.
 */
export const adminGetRunners = async (req, res) => {
  try {
    // Ensure at least one default runner exists in PostgreSQL
    await ensureDefaultRunner();

    const [runners, defaultMonitorCount] = await Promise.all([
      prisma.uptimeRunner.findMany({
        orderBy: { id: "asc" },
        include: {
          _count: {
            select: { monitors: true },
          },
        },
      }),
      prisma.uptimeMonitor.count({
        where: { runnerId: null },
      }),
    ]);

    // Mask secrets and credentials from config
    const safeRunners = runners.map((r) => {
      const { config, _count, ...rest } = r;
      const rawConfig = config && typeof config === "object" ? config : {};
      const safeConfig = {
        batchSize: rawConfig.batchSize || null,
        ...(r.type === "lambda"
          ? {
              region: rawConfig.region || null,
              functionName: rawConfig.functionName || null,
            }
          : {}),
        ...(r.type === "http"
          ? {
              url: rawConfig.url ? rawConfig.url.replace(/:[^:@]+@/, ":***@") : null,
              secretEnv: rawConfig.secretEnv ? "***" : undefined,
            }
          : {}),
      };

      return {
        ...rest,
        config: safeConfig,
        monitorCount: _count?.monitors || 0,
        _count: { monitors: _count?.monitors || 0 },
        totalMonitors: (_count?.monitors || 0) + (r.isDefault ? defaultMonitorCount : 0),
      };
    });

    return res.status(200).json({
      success: true,
      runners: safeRunners,
      defaultMonitorCount,
    });
  } catch (error) {
    console.error("[adminGetRunners] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch runners",
    });
  }
};

/**
 * POST /admin/runners
 * Registers a new uptime runner (created with isActive: true by default).
 */
export const adminCreateRunner = async (req, res) => {
  try {
    const { name, type, config } = req.body || {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ success: false, error: "Runner name is required" });
    }

    const trimmedName = name.trim();
    const validTypes = new Set(["local", "lambda", "http"]);
    if (!validTypes.has(type)) {
      return res.status(400).json({
        success: false,
        error: "Invalid runner type. Allowed types are: local, lambda, http",
      });
    }

    const cleanConfig = config && typeof config === "object" ? { ...config } : {};

    // Secrets policy: Secrets must live in environment variables only, not in DB config JSON
    if (cleanConfig.secret || cleanConfig.secretAccessKey || cleanConfig.accessKeyId) {
      return res.status(400).json({
        success: false,
        error:
          "Security violation: Raw credentials and secrets must live in environment variables only (e.g. AWS_UPTIME_KEY_ID or RUNNER_SECRET), not in database config JSON.",
      });
    }

    // Type-specific validations
    if (type === "lambda") {
      if (!cleanConfig.functionName || typeof cleanConfig.functionName !== "string" || !cleanConfig.functionName.trim()) {
        return res.status(400).json({
          success: false,
          error: "Lambda runner requires 'config.functionName'",
        });
      }
      cleanConfig.functionName = cleanConfig.functionName.trim();
    } else if (type === "http") {
      if (!cleanConfig.url || typeof cleanConfig.url !== "string" || !cleanConfig.url.trim()) {
        return res.status(400).json({
          success: false,
          error: "HTTP runner requires 'config.url'",
        });
      }
      const validation = await validateHttpRunnerTarget(cleanConfig.url.trim());
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: validation.error,
        });
      }
      cleanConfig.url = validation.url;
      cleanConfig.secretEnv = cleanConfig.secretEnv?.trim() || "RUNNER_SECRET";
    }

    const runner = await prisma.uptimeRunner.create({
      data: {
        name: trimmedName,
        type,
        config: cleanConfig,
        isActive: true, // Created active and available for assignment
        isDefault: false,
      },
    });

    clearRunnerCache();

    console.log(`[Admin] Runner '${runner.name}' (${runner.type}) created by ${req.user?.email || "Admin"}`);

    return res.status(201).json({
      success: true,
      message: "Runner created successfully",
      runner: {
        id: runner.id,
        name: runner.name,
        type: runner.type,
        isActive: runner.isActive,
        isDefault: runner.isDefault,
        createdAt: runner.createdAt,
        updatedAt: runner.updatedAt,
      },
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        error: "A runner with this name already exists",
      });
    }
    console.error("[adminCreateRunner] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while creating runner",
    });
  }
};

/**
 * PUT /admin/runners/:id/default
 * Sets a runner as the system default in a single atomic transaction.
 * Changing default instantly moves all unassigned monitors.
 */
export const adminSetDefaultRunner = async (req, res) => {
  try {
    const { id } = req.params;
    const runnerId = parseInt(id, 10);
    if (Number.isNaN(runnerId)) {
      return res.status(400).json({ success: false, error: "Invalid runner ID" });
    }

    const targetRunner = await prisma.uptimeRunner.findUnique({
      where: { id: runnerId },
    });
    if (!targetRunner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }

    if (!targetRunner.isActive) {
      return res.status(400).json({
        success: false,
        error: "Cannot set a disabled runner as default. Enable the runner first.",
      });
    }

    const currentDefault = await prisma.uptimeRunner.findFirst({
      where: { isDefault: true },
    });

    if (currentDefault?.id === runnerId) {
      return res.status(200).json({
        success: true,
        message: `Runner '${targetRunner.name}' is already the default runner.`,
        runner: targetRunner,
      });
    }

    const defaultMonitorCount = await prisma.uptimeMonitor.count({
      where: { runnerId: null },
    });

    // In one transaction: unset old default and set the new one
    const [, updated] = await prisma.$transaction([
      prisma.uptimeRunner.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      }),
      prisma.uptimeRunner.update({
        where: { id: runnerId },
        data: { isDefault: true },
      }),
    ]);

    clearRunnerCache();

    const actor = req.user?.email || `User #${req.user?.id || req.user?._id}`;
    const timestamp = new Date().toISOString();
    console.log(
      `[AUDIT] Default runner updated by ${actor} from '${currentDefault?.name || "None"}' to '${updated.name}' at ${timestamp}. ${defaultMonitorCount} unassigned monitor(s) will now route to this runner.`
    );

    return res.status(200).json({
      success: true,
      message: `Runner '${updated.name}' set as system default. Note: Changing the default instantly moves all unassigned monitors to this runner.`,
      runner: updated,
      unassignedMonitorsMoved: defaultMonitorCount,
    });
  } catch (error) {
    console.error("[adminSetDefaultRunner] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while setting default runner",
    });
  }
};

/**
 * Deprecated alias for adminSetDefaultRunner.
 */
export const adminActivateRunner = adminSetDefaultRunner;

/**
 * PUT /admin/runners/:id/toggle
 * Enables or disables a runner. Prevents disabling the default runner.
 */
export const adminToggleRunner = async (req, res) => {
  try {
    const { id } = req.params;
    const runnerId = parseInt(id, 10);
    if (Number.isNaN(runnerId)) {
      return res.status(400).json({ success: false, error: "Invalid runner ID" });
    }

    const runner = await prisma.uptimeRunner.findUnique({
      where: { id: runnerId },
    });
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }

    const nextIsActive =
      req.body?.isActive !== undefined ? Boolean(req.body.isActive) : !runner.isActive;

    if (runner.isDefault && !nextIsActive) {
      return res.status(400).json({
        success: false,
        error: "Cannot disable the default runner. Set another enabled runner as default before disabling this one.",
      });
    }

    const updated = await prisma.uptimeRunner.update({
      where: { id: runnerId },
      data: { isActive: nextIsActive },
    });

    clearRunnerCache();

    console.log(
      `[Admin] Runner '${updated.name}' ${nextIsActive ? "enabled" : "disabled"} by ${req.user?.email || "Admin"}`
    );

    return res.status(200).json({
      success: true,
      message: `Runner '${updated.name}' ${nextIsActive ? "enabled" : "disabled"} successfully`,
      runner: updated,
    });
  } catch (error) {
    console.error("[adminToggleRunner] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while toggling runner status",
    });
  }
};

/**
 * POST /admin/runners/:id/test
 * Probes a single known-good URL through the specified runner to verify connectivity.
 */
export const adminTestRunner = async (req, res) => {
  try {
    const { id } = req.params;
    const runnerId = parseInt(id, 10);
    if (Number.isNaN(runnerId)) {
      return res.status(400).json({ success: false, error: "Invalid runner ID" });
    }

    const runner = await prisma.uptimeRunner.findUnique({
      where: { id: runnerId },
    });
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }

    const testUrl = req.body?.testUrl || "https://httpbin.org/status/200";
    const runnerFn = RUNNERS[runner.type];
    if (!runnerFn) {
      return res.status(400).json({
        success: false,
        error: `Unsupported runner type: ${runner.type}`,
      });
    }

    const startTime = performance.now();
    try {
      const testResults = await runnerFn(
        [{ id: 0, url: testUrl }],
        runner.config
      );
      const durationMs = Math.round(performance.now() - startTime);

      const probeResult = testResults?.[0]?.result || {};
      const ok = probeResult.status === "UP";

      return res.status(200).json({
        success: true,
        ok,
        ms: durationMs,
        status: probeResult.status || "UNKNOWN",
        httpStatus: probeResult.httpStatus || null,
        runner: runner.name,
        type: runner.type,
        result: probeResult,
      });
    } catch (testErr) {
      const durationMs = Math.round(performance.now() - startTime);
      console.warn(
        `[Admin] Runner test failed for '${runner.name}' (${runner.type}):`,
        testErr.message
      );
      return res.status(200).json({
        success: true,
        ok: false,
        ms: durationMs,
        status: "DOWN",
        error: testErr.message,
        runner: runner.name,
        type: runner.type,
      });
    }
  } catch (error) {
    console.error("[adminTestRunner] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while testing runner",
    });
  }
};

/**
 * DELETE /admin/runners/:id
 * Removes a runner from the database. Prevents deletion of the default runner.
 * Automatically reassigns any associated monitors to NULL (default).
 */
export const adminDeleteRunner = async (req, res) => {
  try {
    const { id } = req.params;
    const runnerId = parseInt(id, 10);
    if (Number.isNaN(runnerId)) {
      return res.status(400).json({ success: false, error: "Invalid runner ID" });
    }

    const runner = await prisma.uptimeRunner.findUnique({
      where: { id: runnerId },
    });
    if (!runner) {
      return res.status(404).json({ success: false, error: "Runner not found" });
    }

    if (runner.isDefault) {
      return res.status(400).json({
        success: false,
        error: "Cannot delete the default runner. Set another runner as default before deleting this one.",
      });
    }

    const reassignedCount = await prisma.uptimeMonitor.count({
      where: { runnerId },
    });

    await prisma.$transaction([
      prisma.uptimeMonitor.updateMany({
        where: { runnerId },
        data: { runnerId: null },
      }),
      prisma.uptimeRunner.delete({
        where: { id: runnerId },
      }),
    ]);

    clearRunnerCache();

    const actor = req.user?.email || `User #${req.user?.id || req.user?._id}`;
    const timestamp = new Date().toISOString();
    console.log(
      `[AUDIT] Runner #${runnerId} ('${runner.name}') deleted by ${actor} at ${timestamp}. Reassigned ${reassignedCount} monitor(s) to system default (NULL).`
    );

    return res.status(200).json({
      success: true,
      message: `Runner '${runner.name}' deleted successfully. Reassigned ${reassignedCount} monitor(s) to system default.`,
      reassignedCount,
    });
  } catch (error) {
    console.error("[adminDeleteRunner] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while deleting runner",
    });
  }
};

/**
 * PATCH /admin/monitors/:id/runner
 * Assigns a single monitor to a specific runner (or null for default).
 */
export const adminAssignMonitorRunner = async (req, res) => {
  try {
    const { id } = req.params;
    const monitorId = parseInt(id, 10);
    if (Number.isNaN(monitorId)) {
      return res.status(400).json({ success: false, error: "Invalid monitor ID" });
    }

    const monitor = await prisma.uptimeMonitor.findUnique({
      where: { id: monitorId },
    });
    if (!monitor) {
      return res.status(404).json({ success: false, error: "Monitor not found" });
    }

    const { runnerId } = req.body || {};
    let targetRunnerId = null;
    let targetRunnerName = "System Default";

    if (
      runnerId !== null &&
      runnerId !== undefined &&
      runnerId !== "default" &&
      runnerId !== "null"
    ) {
      const parsedRunnerId = parseInt(runnerId, 10);
      if (Number.isNaN(parsedRunnerId)) {
        return res.status(400).json({ success: false, error: "Invalid runner ID format" });
      }

      const runner = await prisma.uptimeRunner.findUnique({
        where: { id: parsedRunnerId },
      });
      if (!runner) {
        return res.status(404).json({ success: false, error: "Target runner not found" });
      }
      if (!runner.isActive) {
        return res.status(400).json({
          success: false,
          error: "Cannot assign monitor to a disabled runner. Enable the runner first.",
        });
      }

      targetRunnerId = runner.id;
      targetRunnerName = runner.name;
    }

    const updated = await prisma.uptimeMonitor.update({
      where: { id: monitorId },
      data: { runnerId: targetRunnerId },
      include: {
        runner: {
          select: { id: true, name: true, type: true, isActive: true, isDefault: true },
        },
      },
    });

    const actor = req.user?.email || `User #${req.user?.id || req.user?._id}`;
    const timestamp = new Date().toISOString();
    console.log(
      `[AUDIT] Monitor #${monitor.id} reassigned by ${actor} from runner '${
        monitor.runnerId ?? "default"
      }' to '${targetRunnerName}' (ID: ${targetRunnerId ?? "default"}) at ${timestamp}`
    );

    return res.status(200).json({
      success: true,
      message: `Monitor runner updated to ${targetRunnerName}`,
      monitor: formatAdminMonitor(updated),
    });
  } catch (error) {
    console.error("[adminAssignMonitorRunner] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while assigning runner to monitor",
    });
  }
};

/**
 * POST /admin/monitors/bulk-runner
 * Assigns a batch of up to 500 monitors to a specific runner (or null for default).
 */
export const adminBulkAssignMonitorRunner = async (req, res) => {
  try {
    const { monitorIds, runnerId } = req.body || {};

    if (!Array.isArray(monitorIds) || monitorIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "monitorIds must be a non-empty array of numbers",
      });
    }

    if (monitorIds.length > 500) {
      return res.status(400).json({
        success: false,
        error: "Maximum 500 monitors can be assigned per bulk request",
      });
    }

    const validIds = monitorIds
      .map((id) => (typeof id === "number" ? id : parseInt(id, 10)))
      .filter((id) => Number.isInteger(id));

    if (validIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid numeric monitor IDs provided",
      });
    }

    let targetRunnerId = null;
    let targetRunnerName = "System Default";

    if (
      runnerId !== null &&
      runnerId !== undefined &&
      runnerId !== "default" &&
      runnerId !== "null"
    ) {
      const parsedRunnerId = parseInt(runnerId, 10);
      if (Number.isNaN(parsedRunnerId)) {
        return res.status(400).json({ success: false, error: "Invalid runner ID format" });
      }

      const runner = await prisma.uptimeRunner.findUnique({
        where: { id: parsedRunnerId },
      });
      if (!runner) {
        return res.status(404).json({ success: false, error: "Target runner not found" });
      }
      if (!runner.isActive) {
        return res.status(400).json({
          success: false,
          error: "Cannot assign monitors to a disabled runner. Enable the runner first.",
        });
      }

      targetRunnerId = runner.id;
      targetRunnerName = runner.name;
    }

    const result = await prisma.uptimeMonitor.updateMany({
      where: { id: { in: validIds } },
      data: { runnerId: targetRunnerId },
    });

    const actor = req.user?.email || `User #${req.user?.id || req.user?._id}`;
    const timestamp = new Date().toISOString();
    console.log(
      `[AUDIT] Bulk reassigned ${result.count} monitor(s) to '${targetRunnerName}' (ID: ${
        targetRunnerId ?? "default"
      }) by ${actor} at ${timestamp}`
    );

    return res.status(200).json({
      success: true,
      message: `Successfully reassigned ${result.count} monitor(s) to ${targetRunnerName}`,
      count: result.count,
      runnerId: targetRunnerId,
    });
  } catch (error) {
    console.error("[adminBulkAssignMonitorRunner] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error during bulk runner assignment",
    });
  }
};

/**
 * POST /admin/runners/:id/move-monitors
 * Moves monitors from source runner :id to target runner in bulk.
 * Supports optional filters: { interval, limit, userId }.
 * Source :id can be numeric ID or "default".
 */
export const adminMoveRunnerMonitors = async (req, res) => {
  try {
    const { id } = req.params;
    const { toRunnerId, interval, limit, userId } = req.body || {};

    // 1. Resolve source runner
    let sourceRunnerId = null;
    let sourceRunnerName = "System Default";

    if (id !== "default" && id !== "null" && id !== "0") {
      const parsedSourceId = parseInt(id, 10);
      if (Number.isNaN(parsedSourceId)) {
        return res.status(400).json({ success: false, error: "Invalid source runner ID" });
      }

      const sourceRunner = await prisma.uptimeRunner.findUnique({
        where: { id: parsedSourceId },
      });
      if (!sourceRunner) {
        return res.status(404).json({ success: false, error: "Source runner not found" });
      }

      sourceRunnerId = sourceRunner.id;
      sourceRunnerName = sourceRunner.name;
    }

    // 2. Resolve target runner
    let targetRunnerId = null;
    let targetRunnerName = "System Default";

    if (
      toRunnerId !== null &&
      toRunnerId !== undefined &&
      toRunnerId !== "default" &&
      toRunnerId !== "null"
    ) {
      const parsedTargetId = parseInt(toRunnerId, 10);
      if (Number.isNaN(parsedTargetId)) {
        return res.status(400).json({ success: false, error: "Invalid target runner ID" });
      }

      const targetRunner = await prisma.uptimeRunner.findUnique({
        where: { id: parsedTargetId },
      });
      if (!targetRunner) {
        return res.status(404).json({ success: false, error: "Target runner not found" });
      }
      if (!targetRunner.isActive) {
        return res.status(400).json({
          success: false,
          error: "Target runner is disabled. Enable it before moving monitors.",
        });
      }

      targetRunnerId = targetRunner.id;
      targetRunnerName = targetRunner.name;
    }

    if (sourceRunnerId === targetRunnerId) {
      return res.status(400).json({
        success: false,
        error: "Source and target runners are identical. Nothing to move.",
      });
    }

    // 3. Build where filter for source monitors
    const where = { runnerId: sourceRunnerId };

    if (interval && ALLOWED_INTERVALS.has(interval)) {
      where.interval = toPrismaInterval(interval);
    }

    if (userId) {
      const parsedUserId = parseInt(userId, 10);
      if (!Number.isNaN(parsedUserId)) {
        where.userId = parsedUserId;
      }
    }

    let movedCount = 0;

    // Optional limit
    if (limit) {
      const limitNum = parseInt(limit, 10);
      if (!Number.isNaN(limitNum) && limitNum > 0) {
        const monitorsToMove = await prisma.uptimeMonitor.findMany({
          where,
          select: { id: true },
          take: limitNum,
        });

        const idsToMove = monitorsToMove.map((m) => m.id);
        if (idsToMove.length > 0) {
          const updateResult = await prisma.uptimeMonitor.updateMany({
            where: { id: { in: idsToMove } },
            data: { runnerId: targetRunnerId },
          });
          movedCount = updateResult.count;
        }
      }
    } else {
      const updateResult = await prisma.uptimeMonitor.updateMany({
        where,
        data: { runnerId: targetRunnerId },
      });
      movedCount = updateResult.count;
    }

    const actor = req.user?.email || `User #${req.user?.id || req.user?._id}`;
    const timestamp = new Date().toISOString();
    console.log(
      `[AUDIT] Moved ${movedCount} monitor(s) from '${sourceRunnerName}' (ID: ${
        sourceRunnerId ?? "default"
      }) to '${targetRunnerName}' (ID: ${
        targetRunnerId ?? "default"
      }) by ${actor} at ${timestamp}`
    );

    return res.status(200).json({
      success: true,
      message: `Successfully moved ${movedCount} monitor(s) from ${sourceRunnerName} to ${targetRunnerName}`,
      movedCount,
      fromRunnerId: sourceRunnerId,
      toRunnerId: targetRunnerId,
    });
  } catch (error) {
    console.error("[adminMoveRunnerMonitors] Error:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while moving monitors",
    });
  }
};
