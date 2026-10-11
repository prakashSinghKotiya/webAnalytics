import * as cookie from "cookie";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import Session from "../Models/Session.Model.js";
import { guestCookieName } from "./guestDemo.Mw.js";

const parseCookies = (header) => {
  if (!header || typeof header !== "string") return {};
  try {
    if (typeof cookie.parseCookie === "function") {
      return cookie.parseCookie(header);
    }
    if (typeof cookie.parse === "function") {
      return cookie.parse(header);
    }
  } catch (err) {
    console.error("[SocketAuth] Cookie parse failed:", err.message);
  }
  return {};
};

export const socketAuthMiddleware = async (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie;
    const cookies = parseCookies(cookieHeader);

    // 1. Authenticated user takes priority:
    // Sources: auth.token / auth.sessionId, Authorization header (Bearer), x-session-id header, query.token, or signed cookie (sid)
    const authPayloadToken = socket.handshake.auth?.token || socket.handshake.auth?.sessionId;
    const authHeader = socket.handshake.headers?.authorization;
    const bearerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    const headerToken = socket.handshake.headers?.["x-session-id"];
    const queryToken = socket.handshake.query?.token;
    const rawCookieToken = cookies.sid;
    const cookieSessionId = rawCookieToken && cookieParser.signedCookie(rawCookieToken, process.env.COOKIE_SECRET);

    const candidateSessionId =
      authPayloadToken ||
      bearerToken ||
      headerToken ||
      queryToken ||
      (cookieSessionId && cookieSessionId !== rawCookieToken ? cookieSessionId : null);

    if (candidateSessionId && mongoose.Types.ObjectId.isValid(candidateSessionId)) {
      const session = await Session.findById(candidateSessionId).lean();
      if (session) {
        const userRoom = `user:${session.userId}`;
        socket.data.userId = session.userId.toString();
        socket.data.roomId = userRoom;
        socket.data.roomIds = [userRoom];
        delete socket.data.guestId;
        console.log(`[SocketAuth] Authenticated user connected: ${session.userId} (Room: ${userRoom})`);
        return next();
      }
    }

    // 2. Guest demo fallback: ONLY active if the user is unauthenticated
    // Sources: auth.guestId, query.guestId, x-guest-id header, or signed guest cookie (gid)
    const authGuestId = socket.handshake.auth?.guestId || socket.handshake.query?.guestId || socket.handshake.headers?.["x-guest-id"];
    const rawGuestCookie = cookies[guestCookieName];
    const cookieGuestId = rawGuestCookie && cookieParser.signedCookie(rawGuestCookie, process.env.COOKIE_SECRET);

    let guestId = null;
    if (typeof authGuestId === "string" && /^[a-f0-9]{32}$/i.test(authGuestId)) {
      guestId = authGuestId;
    } else if (typeof cookieGuestId === "string" && cookieGuestId !== rawGuestCookie && /^[a-f0-9]{32}$/i.test(cookieGuestId)) {
      guestId = cookieGuestId;
    }

    if (guestId) {
      const guestRoom = `guest:${guestId}`;
      socket.data.guestId = guestId;
      socket.data.roomId = guestRoom;
      socket.data.roomIds = [guestRoom];
      delete socket.data.userId;
      console.log(`[SocketAuth] Guest demo client connected: ${guestId} (Room: ${guestRoom})`);
      return next();
    }

    console.warn(`[SocketAuth] Rejected connection from ${socket.id}: No valid session or guestId found.`);
    return next(new Error("Authentication required. Please provide a valid session token or guestId."));
  } catch (error) {
    console.error("Socket authentication error:", error);
    next(new Error("Invalid authentication token"));
  }
};


