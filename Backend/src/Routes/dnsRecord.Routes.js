import express from "express";
import {
  dnsRecordLookup,
  getDnsRecordById,
  getDnsRecordResults,
} from "../Controllers/dnsRecord.Controller.js";
import checkAuth from "../Middleware/authentication.Mw.js";
import { optionalActor } from "../Middleware/guestDemo.Mw.js";
import { guestDemoRateLimiter } from "../Middleware/guestDemoRateLimit.Mw.js";
import { reserveGuestDemo } from "../Middleware/guestDemoUsage.Mw.js";
import { validateDnsDemoRequest } from "../Services/publicUrl.Service.js";

const router = express.Router();

router.post(
  "/lookup",
  optionalActor,
  guestDemoRateLimiter,
  validateDnsDemoRequest,
  reserveGuestDemo("dns"),
  dnsRecordLookup
);

router.get("/results", checkAuth, getDnsRecordResults);
router.get("/result/:id", checkAuth, getDnsRecordById);

export default router;
