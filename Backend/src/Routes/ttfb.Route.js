import express from "express";
import {
  allRegionttfbFinder,
  getTtfbById,
  getTtfbResults,
  ttfbFinder,
} from "../Controllers/ttfb.Controller.js";
import checkAuth from "../Middleware/authentication.Mw.js";
import { optionalActor } from "../Middleware/guestDemo.Mw.js";
import { reserveGuestDemo } from "../Middleware/guestDemoUsage.Mw.js";
import { guestDemoRateLimiter } from "../Middleware/guestDemoRateLimit.Mw.js";
import { validateTtfbDemoRequest, validateAllTtfbDemoRequest } from "../Services/publicUrl.Service.js";

const router = express.Router();

router.post("/find", optionalActor, guestDemoRateLimiter, validateTtfbDemoRequest, reserveGuestDemo("ttfb"), ttfbFinder);
// A guest may use their one daily TTFB demo for either one probe or all
// probes. The reservation wraps the whole fan-out, not each regional job.
router.post("/findAll", optionalActor, guestDemoRateLimiter, validateAllTtfbDemoRequest, reserveGuestDemo("ttfb"), allRegionttfbFinder);
router.get("/results", checkAuth, getTtfbResults);
router.get("/result/:id", checkAuth, getTtfbById);

export default router;
