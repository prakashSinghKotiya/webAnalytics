import crypto from "node:crypto";
import Session from "../Models/Session.Model.js";
import User from "../Models/User.Model.js";

const GUEST_COOKIE = "gid";
const GUEST_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

const guestCookieOptions = {
  httpOnly: true,
  signed: true,
  maxAge: GUEST_COOKIE_MAX_AGE_MS,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
};

const validGuestId = (value) =>
  typeof value === "string" && /^[a-f0-9]{32}$/i.test(value);

// This middleware intentionally does not reject visitors without a session.
// Only the demo routes mount it; account routes continue to use checkAuth.
export const optionalActor = async (req, res, next) => {
  try {
    const sessionId = req.signedCookies?.sid;

    if (sessionId) {
      const session = await Session.findById(sessionId).lean();
      if (session) {
        const user = await User.findById(session.userId).lean();
        if (user && !user.deleted) {
          req.user = user;
          return next();
        }
      }
    }

    let guestId = req.signedCookies?.[GUEST_COOKIE];
    if (!validGuestId(guestId)) {
      guestId = crypto.randomBytes(16).toString("hex");
      res.cookie(GUEST_COOKIE, guestId, guestCookieOptions);
    }

    req.guestId = guestId;
    return next();
  } catch (error) {
    return next(error);
  }
};

// Call this before opening Socket.IO. It both establishes the signed cookie and
// tells the client which room its already-authorized socket will join.
export const initializeGuestDemo = (req, res) => {
  const guestId = req.signedCookies?.[GUEST_COOKIE];
  if (!validGuestId(guestId)) {
    const newGuestId = crypto.randomBytes(16).toString("hex");
    res.cookie(GUEST_COOKIE, newGuestId, guestCookieOptions);
  }

  return res.status(204).end();
};

export const guestCookieName = GUEST_COOKIE;
