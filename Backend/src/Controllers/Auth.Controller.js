import { prisma } from "../config/db.prismaSQL.js";
import { verifyIdToken } from "../Services/gAuth.Service.js";
import { gAuthSchema } from "../Validators/ZodSchema.js";
import { guestCookieName } from "../Middleware/guestDemo.Mw.js";
import z from "zod";

export const loginwithGoogle = async (req, res, next) => {
  try {
    console.log("running auth controller");
    const { idToken } = req.body;

    if (!idToken) {
      console.log("id token is required", req.body);
      return res.status(400).json({ error: "id token is required" });
    }

    const userdata = await verifyIdToken(idToken);
    console.log("raw userdata from google:", userdata);

    const { success, data, error } = gAuthSchema.safeParse(userdata);
    if (!success) {
      return res.status(400).json({ error: z.flattenError(error).fieldErrors });
    }

    const { name, email, picture } = data;
    const normalizedEmail = email.trim().toLowerCase();
    console.log("parsed user data:", { name, email: normalizedEmail, picture });

    let user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (user) {
      if (user.deleted) {
        return res.status(403).json({ error: "your account is deleted contact admin" });
      }

      if (picture && (!user.picture || user.picture.includes("vecteezy"))) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { picture },
        });
      }

      const allSessions = await prisma.session.findMany({
        where: { userId: user.id, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "asc" },
      });
      if (allSessions.length >= 2) {
        const sessionsToDelete = allSessions.slice(0, allSessions.length - 1);
        await prisma.session.deleteMany({
          where: { id: { in: sessionsToDelete.map((s) => s.id) } },
        });
      }
    } else {
      console.log("user doesn't exist, creating new user");
      user = await prisma.user.create({
        data: {
          name,
          email: normalizedEmail,
          picture: picture || undefined,
        },
      });
    }

    const session = await prisma.session.create({
      data: { userId: user.id },
    });
    const sessionExpiryTime = 60 * 1000 * 60 * 24 * 7;

    const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
    const isProduction = process.env.NODE_ENV === "production" || isHttps;

    res.cookie("sid", session.id, {
      httpOnly: true,
      signed: true,
      maxAge: sessionExpiryTime,
      sameSite: "none" ,
      secure: true,
    });

    res.clearCookie(guestCookieName, {
      httpOnly: true,
      signed: true,
      secure: true,
      sameSite: "none",
    });

    const guestId = req.headers["x-guest-id"] || req.body?.guestId || req.signedCookies?.[guestCookieName];
    if (guestId) {
      const io = req.app.get("io");
      if (io) {
        const guestRoom = `guest:${guestId}`;
        const userRoom = `user:${user.id}`;
        try {
          const sockets = await io.in(guestRoom).fetchSockets();
          for (const s of sockets) {
            s.leave(guestRoom);
            s.join(userRoom);
            s.data.userId = user.id.toString();
            s.data.roomId = userRoom;
            s.data.roomIds = [userRoom];
            delete s.data.guestId;
            s.emit("roomMigrated", { roomId: userRoom });
          }
          if (sockets.length > 0) {
            console.log(`[Socket] Migrated ${sockets.length} socket(s) from ${guestRoom} to ${userRoom}`);
          }
        } catch (socketErr) {
          console.error("[Socket] Error migrating guest sockets on login:", socketErr);
        }
      }
    }

    console.log("Saved session:", session.id);

    return res.status(200).json({
      message: "logged in",
      token: session.id,
      sessionId: session.id,
      user: {
        id: user.id,
        _id: user.id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        plan: user.plans || "free",
        role: user.role || "User",
      },
    });
  } catch (err) {
    console.error("Google Auth Error:", err);
    return res.status(500).json({ message: "Something went wrong during Google authentication" });
  }
};
