import express from "express";
import {
  redirectCheckController,
  getRedirectCheckResults,
} from "../Controllers/redirectCheck.Controller.js";
import checkAuth from "../Middleware/authentication.Mw.js";
import { optionalActor } from "../Middleware/guestDemo.Mw.js";
import { guestDemoRateLimiter } from "../Middleware/guestDemoRateLimit.Mw.js";
import { reserveGuestDemo } from "../Middleware/guestDemoUsage.Mw.js";
import { validateRedirectDemoRequest } from "../Services/publicUrl.Service.js";

const router = express.Router();

router.post(
  "/check",
  optionalActor,
  guestDemoRateLimiter,
  validateRedirectDemoRequest,
  reserveGuestDemo("redirect"),
  redirectCheckController
);

router.get("/results", checkAuth, getRedirectCheckResults);

export default router;
