import crypto from "node:crypto";

import { prisma } from "../config/db.prismaSQL.js";




const GUEST_COOKIE = "gid";
const GUEST_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
 
const guestCookieOptions = {
  httpOnly: true,
  signed: true,
  maxAge: GUEST_COOKIE_MAX_AGE_MS,
  secure: true,
  sameSite: "none",
};
 
const validGuestId = (value) =>
  typeof value === "string" && /^[a-f0-9]{32}$/i.test(value);
 
// session ids are UUIDs now (replaces mongoose.Types.ObjectId.isValid)
const isUuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
 
// This middleware intentionally does not reject visitors without a session.
// Only the demo routes mount it; account routes continue to use checkAuth.
export const optionalActor = async (req, res, next) => {
  try {
    // 1. Check for authenticated user via Bearer token, x-session-id header, or signed cookie
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    const sessionId = req.signedCookies?.sid || bearerToken || req.headers["x-session-id"];
 
    if (sessionId && isUuid(sessionId)) {
      // one query: live (non-expired) session + its user, password hash left out
      const session = await prisma.session.findFirst({
        where: { id: sessionId, expiresAt: { gt: new Date() } },
        include: { user: { omit: { password: true } } },
      });
      if (session) {
        const user = session.user;
        if (user && !user.deleted) {
          req.user = user;
          req.sessionId = session.id;
          req.roomId = `user:${user.id}`;
          return next();
        }
      }
    }
 
    // checcking for guest session via signed cookie or x-guest-id header and setting or extendding the cookie if needed
    const headerGuestId = req.headers["x-guest-id"] || req.query?.guestId || req.body?.guestId;
    let guestId = validGuestId(headerGuestId) ? headerGuestId : req.signedCookies?.[GUEST_COOKIE];
 
    if (!validGuestId(guestId)) {
      guestId = crypto.randomBytes(16).toString("hex");
      res.cookie(GUEST_COOKIE, guestId, guestCookieOptions);
    } else {
      // Refresh cookie expiry to maintain active session when supported
      res.cookie(GUEST_COOKIE, guestId, guestCookieOptions);
    }
 
    // Expose header so clients (like iOS Safari) can read and save it even if cookies are blocked
    res.setHeader("x-guest-id", guestId);
 
    req.guestId = guestId;
    req.roomId = `guest:${guestId}`;
    return next();
  } catch (error) {
    return next(error);
  }
};
 
// Call this before opening Socket.IO. It both establishes the signed cookie and
// tells the client which room its already-authorized socket will join.
export const initializeGuestDemo = (req, res) => {
  const headerGuestId = req.headers["x-guest-id"] || req.query?.guestId;
  let guestId = validGuestId(headerGuestId) ? headerGuestId : req.signedCookies?.[GUEST_COOKIE];
 
  if (!validGuestId(guestId)) {
    guestId = crypto.randomBytes(16).toString("hex");
    res.cookie(GUEST_COOKIE, guestId, guestCookieOptions);
  } else {
    // Refresh cookie expiry to maintain active session
    res.cookie(GUEST_COOKIE, guestId, guestCookieOptions);
  }
 
  res.setHeader("x-guest-id", guestId);
 
  const roomId = `guest:${guestId}`;
  return res.status(200).json({
    success: true,
    guestId,
    roomId,
  });
};
 
export const guestCookieName = GUEST_COOKIE;


