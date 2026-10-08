import { rateLimit } from "express-rate-limit";

export const guestDemoRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window for burst DDoS protection
  limit: 20, // allows all 6 daily requests plus retries, while protecting server from abusive spam
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) => Boolean(req.user),
  message: {
    success: false,
    code: "GUEST_DEMO_RATE_LIMITED",
    message: "Too many requests in a short period. Please slow down or sign in.",
  },
});
