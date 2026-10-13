import express from "express";
import checkAuth, { adminChecker, isAdmin } from "../Middleware/authentication.Mw.js";
import {
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
  adminPowerlogout,
  DeleteUser,
  getAllUsers,
} from "../Controllers/Admin.Controller.js";

const router = express.Router();

// ==========================================
// MONITOR RBAC MANAGEMENT ROUTES FOR ADMIN
// ==========================================

// 1. Stats and Total Monitor overview
router.get("/monitors/stats", checkAuth, adminChecker, adminGetMonitorStats);
router.get("/monitors/total", checkAuth, adminChecker, adminGetTotalMonitors);

// 2. Incident Telemetry & Outages
router.get("/monitors/incidents", checkAuth, adminChecker, adminGetMonitorIncidents);

// 3. Export all monitor records
router.get("/monitors/export", checkAuth, adminChecker, adminExportMonitors);

// 4. Fetch all monitors across all users with pagination and filters
router.get("/monitors", checkAuth, adminChecker, adminGetAllMonitors);

// 5. Admin provision new monitor for a user
router.post("/monitors", checkAuth, adminChecker, adminCreateMonitor);

// 6. Delete active monitors (bulk / all active monitors or filtered by user/IDs)
router.delete("/monitors/active", checkAuth, isAdmin, adminDeleteActiveMonitors);
router.post("/monitors/active/delete", checkAuth, isAdmin, adminDeleteActiveMonitors);

// 7. Bulk pause / resume monitors
router.post("/monitors/bulk/pause", checkAuth, adminChecker, adminBulkPauseMonitors);
router.post("/monitors/bulk/resume", checkAuth, adminChecker, adminBulkResumeMonitors);

// 8. Bulk update polling interval
router.post("/monitors/bulk/interval", checkAuth, adminChecker, adminBulkUpdateInterval);

// 9. Bulk delete any monitors (active or paused)
router.post("/monitors/bulk/delete", checkAuth, isAdmin, adminBulkDeleteMonitors);
router.delete("/monitors/bulk", checkAuth, isAdmin, adminBulkDeleteMonitors);

// 10. Single monitor details by ID (including recent checks and owner info)
router.get("/monitors/:id", checkAuth, adminChecker, adminGetMonitorDetails);

// 11. Update monitor settings (URL, interval, status)
router.put("/monitors/:id", checkAuth, adminChecker, adminUpdateMonitor);
router.patch("/monitors/:id", checkAuth, adminChecker, adminUpdateMonitor);

// 12. Trigger immediate ad-hoc probe check
router.post("/monitors/:id/check", checkAuth, adminChecker, adminTriggerMonitorCheck);

// 13. Pause a monitor (both PATCH and POST supported)
router.patch("/monitors/:id/pause", checkAuth, adminChecker, adminPauseMonitor);
router.post("/monitors/:id/pause", checkAuth, adminChecker, adminPauseMonitor);

// 14. Resume / Activate a monitor (both PATCH and POST supported)
router.patch("/monitors/:id/resume", checkAuth, adminChecker, adminResumeMonitor);
router.post("/monitors/:id/resume", checkAuth, adminChecker, adminResumeMonitor);
router.patch("/monitors/:id/activate", checkAuth, adminChecker, adminActivateMonitor);
router.post("/monitors/:id/activate", checkAuth, adminChecker, adminActivateMonitor);

// 15. Delete a monitor (both DELETE and POST supported)
router.delete("/monitors/:id", checkAuth, isAdmin, adminDeleteMonitor);
router.post("/monitors/:id/delete", checkAuth, isAdmin, adminDeleteMonitor);

// 16. Clear probe results history for a monitor
router.delete("/monitors/:id/results", checkAuth, isAdmin, adminClearMonitorResults);
router.post("/monitors/:id/results/clear", checkAuth, isAdmin, adminClearMonitorResults);


// ==========================================
// USER MANAGEMENT ROUTES FOR ADMIN
// ==========================================

router.get("/getusers", checkAuth, adminChecker, getAllUsers);
router.get("/users", checkAuth, adminChecker, getAllUsers);

router.post("/users/:userId/logout", checkAuth, adminChecker, adminPowerlogout);
router.delete("/users/:userId", checkAuth, isAdmin, DeleteUser);

// Legacy routes for backward compatibility
router.post("/:userId/logout", checkAuth, adminChecker, adminPowerlogout);
router.post("/:userId", checkAuth, isAdmin, DeleteUser);

export default router;