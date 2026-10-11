import express from "express";
import {
  getLighthouseById,
  getLighthouseResults,
  getLighthouseStatus,
  LighthouseResult,
} from "../Controllers/lighthouse.Controller.js";
import checkAuth from "../Middleware/authentication.Mw.js";
import { optionalActor } from "../Middleware/guestDemo.Mw.js";
import { reserveGuestDemo } from "../Middleware/guestDemoUsage.Mw.js";
import { guestDemoRateLimiter } from "../Middleware/guestDemoRateLimit.Mw.js";
import { validateLighthouseDemoRequest } from "../Services/publicUrl.Service.js";

const router = express.Router();

router.post("/report", optionalActor, guestDemoRateLimiter, validateLighthouseDemoRequest, reserveGuestDemo("lighthouse"), LighthouseResult);
router.get("/results", checkAuth, getLighthouseResults);
router.get("/result/:id", optionalActor, getLighthouseById);
router.get("/status/:id", optionalActor, getLighthouseStatus);

export default router;
