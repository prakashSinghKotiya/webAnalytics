import express from "express";

import {
    createMonitor,
    deleteMonitor,
    getMonitors,
    getRecentMonitorResults,
    getRunningMonitorDetails,
    pauseMonitor,
    resumeMonitor,
    updateMonitor
} from "../Controllers/uptimeRobot.Controller.js";

const router = express.Router();

router.post("/create", createMonitor);
router.put("/update/:id", updateMonitor);
router.post("/delete/:id", deleteMonitor);
router.patch("/pause/:id", pauseMonitor);
router.patch("/resume/:id", resumeMonitor);
router.get("/monitors", getMonitors);
router.get("/monitor/:id", getRunningMonitorDetails);
router.get("/monitor/:id/results", getRecentMonitorResults);

export default router;