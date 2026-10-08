import express from "express";
import {
  whoisLookupController,
  getWhoisLookupResults,
} from "../Controllers/whoisLookup.Controller.js";
import checkAuth from "../Middleware/authentication.Mw.js";
import { optionalActor } from "../Middleware/guestDemo.Mw.js";
import { guestDemoRateLimiter } from "../Middleware/guestDemoRateLimit.Mw.js";
import { reserveGuestDemo } from "../Middleware/guestDemoUsage.Mw.js";
import { validateWhoisDemoRequest } from "../Services/publicUrl.Service.js";

const router = express.Router();

router.post(
  "/lookup",
  optionalActor,
  guestDemoRateLimiter,
  validateWhoisDemoRequest,
  reserveGuestDemo("whois"),
  whoisLookupController
);

router.get("/results", checkAuth, getWhoisLookupResults);

export default router;
