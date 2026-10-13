import express from "express";
import { adminChecker, isAdmin } from "../Middleware/authentication.Mw.js";

import {
    createMonitor,
    deleteMonitor,
    getMonitors,
    getRecentMonitorResults,
    getRunningMonitorDetails,
    pauseMonitor,
    resumeMonitor,
    updateMonitor,
    adminGetMonitorStats,
    adminGetTotalMonitors,
    adminGetAllMonitors,
    adminGetMonitorDetails,
    adminPauseMonitor,
    adminResumeMonitor,
    adminActivateMonitor,
    adminDeleteMonitor,
    adminDeleteActiveMonitors,
    adminBulkPauseMonitors,
    adminBulkResumeMonitors,
    adminTriggerMonitorCheck,
    adminCreateMonitor,
    adminUpdateMonitor,
    adminBulkDeleteMonitors,
    adminClearMonitorResults,
    adminBulkUpdateInterval,
    adminGetMonitorIncidents,
    adminExportMonitors,
} from "../Controllers/uptimeRobot.Controller.js";

const router = express.Router();

// ==========================================
// USER MONITOR ROUTES (/uptime)
// ==========================================
router.post("/create", createMonitor);
router.put("/update/:id", updateMonitor);
router.post("/delete/:id", deleteMonitor);
router.patch("/pause/:id", pauseMonitor);
router.patch("/resume/:id", resumeMonitor);
router.get("/monitors", getMonitors);
router.get("/monitor/:id", getRunningMonitorDetails);
router.get("/monitor/:id/results", getRecentMonitorResults);

// ==========================================
// ADMIN RBAC MONITOR ROUTES (/uptime/admin/...)
// ==========================================
router.get("/admin/stats", adminChecker, adminGetMonitorStats);
router.get("/admin/total", adminChecker, adminGetTotalMonitors);
router.get("/admin/incidents", adminChecker, adminGetMonitorIncidents);
router.get("/admin/export", adminChecker, adminExportMonitors);
router.get("/admin/monitors", adminChecker, adminGetAllMonitors);
router.post("/admin/create", adminChecker, adminCreateMonitor);
router.get("/admin/monitor/:id", adminChecker, adminGetMonitorDetails);
router.put("/admin/monitor/:id", adminChecker, adminUpdateMonitor);
router.patch("/admin/monitor/:id", adminChecker, adminUpdateMonitor);
router.post("/admin/monitor/:id/check", adminChecker, adminTriggerMonitorCheck);

router.delete("/admin/active", isAdmin, adminDeleteActiveMonitors);
router.post("/admin/active/delete", isAdmin, adminDeleteActiveMonitors);

router.post("/admin/bulk/pause", adminChecker, adminBulkPauseMonitors);
router.post("/admin/bulk/resume", adminChecker, adminBulkResumeMonitors);
router.post("/admin/bulk/interval", adminChecker, adminBulkUpdateInterval);
router.post("/admin/bulk/delete", isAdmin, adminBulkDeleteMonitors);
router.delete("/admin/bulk", isAdmin, adminBulkDeleteMonitors);

router.patch("/admin/pause/:id", adminChecker, adminPauseMonitor);
router.post("/admin/pause/:id", adminChecker, adminPauseMonitor);

router.patch("/admin/resume/:id", adminChecker, adminResumeMonitor);
router.post("/admin/resume/:id", adminChecker, adminResumeMonitor);

router.patch("/admin/activate/:id", adminChecker, adminActivateMonitor);
router.post("/admin/activate/:id", adminChecker, adminActivateMonitor);

router.delete("/admin/delete/:id", isAdmin, adminDeleteMonitor);
router.post("/admin/delete/:id", isAdmin, adminDeleteMonitor);

router.delete("/admin/monitor/:id/results", isAdmin, adminClearMonitorResults);
router.post("/admin/monitor/:id/results/clear", isAdmin, adminClearMonitorResults);

export default router;