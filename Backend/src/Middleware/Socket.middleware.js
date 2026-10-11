import * as cookie from "cookie";
import cookieParser from "cookie-parser";
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
    if (!cookieHeader) return next(new Error("Authentication required. No cookies found."));

    const cookies = parseCookies(cookieHeader);
    const rawToken = cookies.sid;

    // 1. Authenticated user takes priority: joins ONLY their user room
    if (rawToken) {
      const sessionId = cookieParser.signedCookie(rawToken, process.env.COOKIE_SECRET);
      if (sessionId && sessionId !== rawToken) {
        const session = await Session.findById(sessionId).lean();
        if (session) {
          const userRoom = `user:${session.userId}`;
          socket.data.userId = session.userId.toString();
          socket.data.roomId = userRoom;
          socket.data.roomIds = [userRoom];
          delete socket.data.guestId;
          return next();
        }
      }
    }

    // 2. Guest demo fallback: ONLY active if the user is unauthenticated
    const rawGuestCookie = cookies[guestCookieName];
    const guestId = rawGuestCookie && cookieParser.signedCookie(rawGuestCookie, process.env.COOKIE_SECRET);
    if (typeof guestId === "string" && guestId !== rawGuestCookie && /^[a-f0-9]{32}$/i.test(guestId)) {
      const guestRoom = `guest:${guestId}`;
      socket.data.guestId = guestId;
      socket.data.roomId = guestRoom;
      socket.data.roomIds = [guestRoom];
      delete socket.data.userId;
      return next();
    }

    return next(new Error("Authentication required. Initialize a guest demo session first."));
  } catch (error) {
    console.error("Socket authentication error:", error);
    next(new Error("Invalid authentication token"));
  }
};

