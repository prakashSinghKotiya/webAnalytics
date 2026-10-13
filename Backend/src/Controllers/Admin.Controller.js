import mongoose, { Types } from "mongoose";
import { UptimeMonitor } from "../Models/UptimeMonitor.Model.js";
import { UptimeResult } from "../Models/UptimeResults.Model.js";
import User from "../Models/User.Model.js";
import {
  createUptimeScheduler,
  updateUptimeScheduler,
  removeUptimeScheduler,
} from "../Services/uptimeScheduler.Service.js";
import { checkUrl } from "../Services/uptimeChecker.Service.js";

// Re-export existing user admin operations for unified controller access
export { getAllUsers, adminPowerlogout, DeleteUser } from "./User.Controller.js";

const ALLOWED_INTERVALS = new Set(["1m", "5m", "10m", "30m", "1h"]);
const ALLOWED_STATUSES = new Set(["active", "paused"]);

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
      distinctUserIds,
      totalResultRecords,
      intervalAgg,
    ] = await Promise.all([
      UptimeMonitor.countDocuments(),
      UptimeMonitor.countDocuments({ status: "active" }),
      UptimeMonitor.countDocuments({ status: "paused" }),
      UptimeMonitor.countDocuments({ "lastResult.status": "UP" }),
      UptimeMonitor.countDocuments({ "lastResult.status": "DOWN" }),
      UptimeMonitor.countDocuments({ lastResult: null }),
      UptimeMonitor.distinct("userId"),
      UptimeResult.countDocuments(),
      UptimeMonitor.aggregate([
        { $group: { _id: "$interval", count: { $sum: 1 } } },
      ]),
    ]);

    const intervalBreakdown = {
      "1m": 0,
      "5m": 0,
      "10m": 0,
      "30m": 0,
      "1h": 0,
    };

    intervalAgg.forEach((item) => {
      if (item._id && intervalBreakdown.hasOwnProperty(item._id)) {
        intervalBreakdown[item._id] = item.count;
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
        totalUsersWithMonitors: distinctUserIds.length,
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
      search,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      order = "desc",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const query = {};

    if (status && ALLOWED_STATUSES.has(status)) {
      query.status = status;
    }

    if (userId) {
      if (!Types.ObjectId.isValid(userId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid userId format",
        });
      }
      query.userId = new Types.ObjectId(userId);
    }

    if (interval && ALLOWED_INTERVALS.has(interval)) {
      query.interval = interval;
    }

    if (search && typeof search === "string" && search.trim()) {
      query.url = { $regex: search.trim(), $options: "i" };
    }

    const sortOrder = order.toLowerCase() === "asc" ? 1 : -1;
    const allowedSortFields = ["createdAt", "updatedAt", "lastCheckedAt", "url", "status", "interval"];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";

    const [monitors, total] = await Promise.all([
      UptimeMonitor.find(query)
        .populate("userId", "_id name email role deleted picture")
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      UptimeMonitor.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    return res.status(200).json({
      success: true,
      data: monitors,
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
    const { id } = req.params;

    if (!id || !Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid monitor ID format",
      });
    }

    const monitor = await UptimeMonitor.findById(id)
      .populate("userId", "_id name email role deleted picture")
      .lean();

    if (!monitor) {
      return res.status(404).json({
        success: false,
        error: "Monitor not found",
      });
    }

    const [recentResults, totalChecksCount] = await Promise.all([
      UptimeResult.find({ monitorId: id })
        .sort({ checkedAt: -1 })
        .limit(30)
        .lean(),
      UptimeResult.countDocuments({ monitorId: id }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        monitor,
        recentResults,
        totalChecksCount,
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

    if (!id || !Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid monitor ID format",
      });
    }

    const monitor = await UptimeMonitor.findById(id);

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
        monitor,
      });
    }

    const ownerRoomId = monitor.userId ? `user:${monitor.userId}` : null;

    try {
      await removeUptimeScheduler(monitor._id, ownerRoomId);
    } catch (schedErr) {
      console.warn(`[adminPauseMonitor] Scheduler removal warning for ${id}:`, schedErr.message);
    }

    monitor.status = "paused";
    await monitor.save();

    // Notify the monitor owner via socket if online
    const io = req.app.get("io");
    if (io && ownerRoomId) {
      io.to(ownerRoomId).emit("monitor:statusChange", {
        monitorId: monitor._id.toString(),
        status: "paused",
        action: "paused_by_admin",
        changedAt: new Date(),
      });
    }

    return res.status(200).json({
      success: true,
      message: "Monitor paused by admin successfully",
      monitor,
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

    if (!id || !Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid monitor ID format",
      });
    }

    const monitor = await UptimeMonitor.findById(id);

    if (!monitor) {
      return res.status(404).json({
        success: false,
        error: "Monitor not found",
      });
    }

    // Verify owner account is active
    if (monitor.userId) {
      const owner = await User.findById(monitor.userId);
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
        monitor,
      });
    }

    const previousStatus = monitor.status;
    monitor.status = "active";
    await monitor.save();

    const ownerRoomId = monitor.userId ? `user:${monitor.userId}` : null;

    try {
      await createUptimeScheduler(monitor, ownerRoomId);
    } catch (schedErr) {
      console.error(`[adminResumeMonitor] Scheduler creation failed for ${id}:`, schedErr);
      monitor.status = previousStatus;
      await monitor.save();

      return res.status(500).json({
        success: false,
        error: "Failed to initialize scheduler in background. Monitor remains paused.",
      });
    }

    // Notify the monitor owner via socket if online
    const io = req.app.get("io");
    if (io && ownerRoomId) {
      io.to(ownerRoomId).emit("monitor:statusChange", {
        monitorId: monitor._id.toString(),
        status: "active",
        action: "activated_by_admin",
        changedAt: new Date(),
      });
    }

    return res.status(200).json({
      success: true,
      message: "Monitor activated successfully by admin",
      monitor,
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

    if (!id || !Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid monitor ID format",
      });
    }

    const monitor = await UptimeMonitor.findById(id);

    if (!monitor) {
      return res.status(404).json({
        success: false,
        error: "Monitor not found",
      });
    }

    const ownerRoomId = monitor.userId ? `user:${monitor.userId}` : null;

    // Remove background scheduler job
    try {
      await removeUptimeScheduler(monitor._id, ownerRoomId);
    } catch (schedErr) {
      console.warn(`[adminDeleteMonitor] Scheduler removal warning for ${id}:`, schedErr.message);
    }

    // Delete monitor document and related results
    await Promise.all([
      monitor.deleteOne(),
      UptimeResult.deleteMany({ monitorId: monitor._id }),
    ]);

    // Notify monitor owner via socket
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

    const query = { status: "active" };

    if (queryUserId) {
      if (!Types.ObjectId.isValid(queryUserId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid userId format",
        });
      }
      query.userId = new Types.ObjectId(queryUserId);
    }

    if (Array.isArray(monitorIds) && monitorIds.length > 0) {
      const validIds = monitorIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));

      if (validIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No valid monitor IDs provided in monitorIds array",
        });
      }
      query._id = { $in: validIds };
    }

    const activeMonitors = await UptimeMonitor.find(query);

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
        await removeUptimeScheduler(monitor._id, ownerRoomId);
      } catch (schedErr) {
        console.warn(`[adminDeleteActiveMonitors] Failed to remove scheduler for ${monitor._id}:`, schedErr.message);
      }

      await Promise.all([
        monitor.deleteOne(),
        UptimeResult.deleteMany({ monitorId: monitor._id }),
      ]);

      deletedIds.push(monitor._id.toString());

      if (io && ownerRoomId) {
        io.to(ownerRoomId).emit("monitor:deleted", {
          monitorId: monitor._id.toString(),
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

    const query = { status: "active" };

    if (userId) {
      if (!Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ success: false, error: "Invalid userId format" });
      }
      query.userId = new Types.ObjectId(userId);
    }

    if (Array.isArray(monitorIds) && monitorIds.length > 0) {
      const validIds = monitorIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
      query._id = { $in: validIds };
    }

    const monitorsToPause = await UptimeMonitor.find(query);

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
        await removeUptimeScheduler(monitor._id, ownerRoomId);
      } catch (err) {
        console.warn(`[adminBulkPauseMonitors] Failed to remove scheduler for ${monitor._id}:`, err.message);
      }

      monitor.status = "paused";
      await monitor.save();
      pausedIds.push(monitor._id.toString());

      if (io && ownerRoomId) {
        io.to(ownerRoomId).emit("monitor:statusChange", {
          monitorId: monitor._id.toString(),
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

    const query = { status: "paused" };

    if (userId) {
      if (!Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ success: false, error: "Invalid userId format" });
      }
      query.userId = new Types.ObjectId(userId);
    }

    if (Array.isArray(monitorIds) && monitorIds.length > 0) {
      const validIds = monitorIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
      query._id = { $in: validIds };
    }

    const monitorsToResume = await UptimeMonitor.find(query);

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
      monitor.status = "active";
      await monitor.save();

      try {
        await createUptimeScheduler(monitor, ownerRoomId);
        resumedIds.push(monitor._id.toString());

        if (io && ownerRoomId) {
          io.to(ownerRoomId).emit("monitor:statusChange", {
            monitorId: monitor._id.toString(),
            status: "active",
            action: "bulk_activated_by_admin",
            changedAt: new Date(),
          });
        }
      } catch (err) {
        console.error(`[adminBulkResumeMonitors] Failed to start scheduler for ${monitor._id}:`, err);
        monitor.status = "paused";
        await monitor.save();
        failedIds.push(monitor._id.toString());
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

    if (!id || !Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid monitor ID format",
      });
    }

    const monitor = await UptimeMonitor.findById(id);
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
      UptimeResult.create({
        monitorId: monitor._id,
        userId: monitor.userId,
        result,
        checkedAt,
      }),
      UptimeMonitor.findByIdAndUpdate(
        monitor._id,
        {
          $set: {
            lastResult: result,
            lastCheckedAt: checkedAt,
          },
        },
        { returnDocument: "after" }
      ),
    ]);

    const ownerRoomId = monitor.userId ? `user:${monitor.userId}` : null;
    const io = req.app.get("io");

    const payload = {
      jobId: `manual-admin-${Date.now()}`,
      roomId: ownerRoomId,
      monitorId: monitor._id.toString(),
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
      monitorId: monitor._id.toString(),
      result,
      status: isUp ? "UP" : "DOWN",
      checkedAt,
      resultRecordId: savedResult._id,
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
    const { url, interval = "5m", userId } = req.body || {};

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
        error: `Invalid interval. Allowed values are: ${[...ALLOWED_INTERVALS].join(", ")}`,
      });
    }

    const targetUserId = userId || req.user._id;

    if (!Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ success: false, error: "Invalid userId format" });
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser || targetUser.deleted) {
      return res.status(404).json({ success: false, error: "Target user account not found or deleted" });
    }

    // Check duplicate
    const existing = await UptimeMonitor.findOne({
      userId: targetUserId,
      url: url.trim(),
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        error: "A monitor for this URL already exists for the designated user",
      });
    }

    const monitor = await UptimeMonitor.create({
      url: url.trim(),
      interval,
      status: "active",
      userId: targetUserId,
    });

    const ownerRoomId = `user:${targetUserId}`;

    try {
      await createUptimeScheduler(monitor, ownerRoomId);
    } catch (schedErr) {
      await UptimeMonitor.findByIdAndDelete(monitor._id);
      console.error("[adminCreateMonitor] Scheduler initialization failed:", schedErr);
      return res.status(500).json({
        success: false,
        error: "Failed to initialize the background scheduler for new monitor",
      });
    }

    const io = req.app.get("io");
    if (io && ownerRoomId) {
      io.to(ownerRoomId).emit("monitor:created", {
        monitorId: monitor._id.toString(),
        url: monitor.url,
        interval: monitor.interval,
        status: monitor.status,
        createdBy: "admin",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Monitor created successfully by admin",
      monitor,
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
    const { url, interval, status } = req.body || {};

    if (!id || !Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid monitor ID format" });
    }

    const monitor = await UptimeMonitor.findById(id);
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
          error: `Invalid interval. Allowed values are: ${[...ALLOWED_INTERVALS].join(", ")}`,
        });
      }
      updates.interval = interval;
    }

    if (status !== undefined) {
      if (!ALLOWED_STATUSES.has(status)) {
        return res.status(400).json({ success: false, error: "Invalid status. Must be 'active' or 'paused'" });
      }
      updates.status = status;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: "No fields to update provided" });
    }

    const prevStatus = monitor.status;
    const prevInterval = monitor.interval;

    Object.assign(monitor, updates);
    await monitor.save();

    const ownerRoomId = monitor.userId ? `user:${monitor.userId}` : null;

    try {
      if (monitor.status === "active") {
        if (prevStatus === "paused" || prevInterval !== monitor.interval) {
          await updateUptimeScheduler(monitor, ownerRoomId);
        }
      } else if (monitor.status === "paused") {
        await removeUptimeScheduler(monitor._id, ownerRoomId);
      }
    } catch (schedErr) {
      console.warn(`[adminUpdateMonitor] Scheduler sync warning for ${id}:`, schedErr.message);
    }

    const io = req.app.get("io");
    if (io && ownerRoomId) {
      io.to(ownerRoomId).emit("monitor:statusChange", {
        monitorId: monitor._id.toString(),
        status: monitor.status,
        url: monitor.url,
        interval: monitor.interval,
        action: "updated_by_admin",
        changedAt: new Date(),
      });
    }

    return res.status(200).json({
      success: true,
      message: "Monitor updated successfully by admin",
      monitor,
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

    const query = {};

    if (queryUserId) {
      if (!Types.ObjectId.isValid(queryUserId)) {
        return res.status(400).json({ success: false, error: "Invalid userId format" });
      }
      query.userId = new Types.ObjectId(queryUserId);
    }

    if (Array.isArray(monitorIds) && monitorIds.length > 0) {
      const validIds = monitorIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));

      if (validIds.length === 0) {
        return res.status(400).json({ success: false, error: "No valid monitor IDs provided in monitorIds array" });
      }
      query._id = { $in: validIds };
    }

    if (Object.keys(query).length === 0) {
      return res.status(400).json({
        success: false,
        error: "Either monitorIds array or userId must be provided for bulk deletion",
      });
    }

    const targets = await UptimeMonitor.find(query);
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
        await removeUptimeScheduler(monitor._id, ownerRoomId);
      } catch (schedErr) {
        console.warn(`[adminBulkDeleteMonitors] Scheduler removal error for ${monitor._id}:`, schedErr.message);
      }

      await Promise.all([
        monitor.deleteOne(),
        UptimeResult.deleteMany({ monitorId: monitor._id }),
      ]);

      deletedIds.push(monitor._id.toString());

      if (io && ownerRoomId) {
        io.to(ownerRoomId).emit("monitor:deleted", {
          monitorId: monitor._id.toString(),
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

    if (!id || !Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid monitor ID format" });
    }

    const monitor = await UptimeMonitor.findById(id);
    if (!monitor) {
      return res.status(404).json({ success: false, error: "Monitor not found" });
    }

    const deleteFilter = { monitorId: monitor._id };

    if (olderThanDays !== undefined && olderThanDays !== null && !isNaN(Number(olderThanDays))) {
      const cutoff = new Date(Date.now() - Math.max(0, Number(olderThanDays)) * 86400000);
      deleteFilter.checkedAt = { $lt: cutoff };
    }

    const result = await UptimeResult.deleteMany(deleteFilter);

    // If all results cleared, reset monitor lastResult / lastCheckedAt
    if (!olderThanDays) {
      await UptimeMonitor.findByIdAndUpdate(id, {
        $set: { lastResult: null, lastCheckedAt: null },
      });
    }

    return res.status(200).json({
      success: true,
      message: `Successfully purged ${result.deletedCount} check result records`,
      deletedCount: result.deletedCount,
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
        error: `Invalid interval. Allowed values are: ${[...ALLOWED_INTERVALS].join(", ")}`,
      });
    }

    const query = {};

    if (userId) {
      if (!Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ success: false, error: "Invalid userId format" });
      }
      query.userId = new Types.ObjectId(userId);
    }

    if (Array.isArray(monitorIds) && monitorIds.length > 0) {
      const validIds = monitorIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
      query._id = { $in: validIds };
    }

    if (Object.keys(query).length === 0) {
      return res.status(400).json({
        success: false,
        error: "Either monitorIds array or userId must be specified",
      });
    }

    const monitors = await UptimeMonitor.find(query);
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

    for (const mon of monitors) {
      mon.interval = interval;
      await mon.save();
      updatedIds.push(mon._id.toString());

      const ownerRoomId = mon.userId ? `user:${mon.userId}` : null;

      if (mon.status === "active") {
        try {
          await updateUptimeScheduler(mon, ownerRoomId);
        } catch (err) {
          console.warn(`[adminBulkUpdateInterval] Scheduler error for ${mon._id}:`, err.message);
        }
      }

      if (io && ownerRoomId) {
        io.to(ownerRoomId).emit("monitor:statusChange", {
          monitorId: mon._id.toString(),
          interval: mon.interval,
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
    const incidents = await UptimeMonitor.find({
      $or: [
        { "lastResult.status": "DOWN" },
        { "lastResult.status": "DEGRADED" },
      ],
    })
      .populate("userId", "_id name email role picture")
      .sort({ lastCheckedAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: incidents.length,
      incidents,
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
    const monitors = await UptimeMonitor.find()
      .populate("userId", "_id name email role")
      .sort({ createdAt: -1 })
      .lean();

    const formatted = monitors.map((m) => ({
      id: m._id.toString(),
      url: m.url,
      interval: m.interval,
      status: m.status,
      health: m.lastResult?.status || "PENDING",
      responseTimeMs: m.lastResult?.responseTime ?? null,
      httpStatus: m.lastResult?.httpStatus ?? null,
      lastCheckedAt: m.lastCheckedAt ? new Date(m.lastCheckedAt).toISOString() : null,
      createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : null,
      userEmail: m.userId?.email || "Unknown",
      userName: m.userId?.name || "Unknown",
      userRole: m.userId?.role || "User",
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


