import { Router } from "express";
import {
  submitContactMessage,
  getContactMessages,
  getContactMessageById,
  deleteContactMessage,
} from "../Controllers/Contact.Controller.js";
import checkAuth, { adminChecker } from "../Middleware/authentication.Mw.js";
import { contactLimiter, requstThrottling } from "../Validators/RateLimiting.js";

const router = Router();

// -----------------------------------------------------------------------------
// PUBLIC ROUTE: Submit contact message (with rate limiting & request throttling)
// -----------------------------------------------------------------------------
router.post("/", contactLimiter, requstThrottling, submitContactMessage);

// -----------------------------------------------------------------------------
// ADMIN PROTECTED ROUTES: Only Admin and SuperAdmin roles permitted
// -----------------------------------------------------------------------------
router.get("/", checkAuth, adminChecker, getContactMessages);
router.get("/:id", checkAuth, adminChecker, getContactMessageById);
router.delete("/:id", checkAuth, adminChecker, deleteContactMessage);
router.delete("/", checkAuth, adminChecker, deleteContactMessage);

export default router;
