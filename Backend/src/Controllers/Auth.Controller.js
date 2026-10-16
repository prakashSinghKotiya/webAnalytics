import mongoose, { Types } from "mongoose";
import Session from "../Models/Session.Model.js";
import User from "../Models/User.Model.js";
import { verifyIdToken } from "../Services/gAuth.Service.js";
import { gAuthSchema } from "../Validators/ZodSchema.js";
import { guestCookieName } from "../Middleware/guestDemo.Mw.js";
import z from "zod";

export const loginwithGoogle = async (req, res, next) => {
  let mongooseSession = null;

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
    console.log("parsed user data:", { name, email, picture });

    let user = await User.findOne({ email });

    if (user) {
      if (user.deleted) {
        return res.status(403).json({ error: "your account is deleted contact admin" });
      }

      if (picture && (!user.picture || user.picture.includes("vecteezy"))) {
        user.picture = picture;
        await user.save();
      }

      const allSessions = await Session.find({ userId: user._id });
      if (allSessions.length >= 2) {
        await allSessions[0].deleteOne();
      }
    } else {
      console.log("user doesn't exist, creating new user");
      mongooseSession = await mongoose.startSession();
      mongooseSession.startTransaction();

      const userId = new Types.ObjectId();
      const createdUsers = await User.create(
        [
          {
            _id: userId,
            name,
            email,
            picture: picture || undefined,
          },
        ],
        { session: mongooseSession }
      );
      user = createdUsers[0];

      await mongooseSession.commitTransaction();
      mongooseSession.endSession();
      mongooseSession = null;
    }

    const session = await Session.create({ userId: user._id });
    const sessionExpiryTime = 60 * 1000 * 60 * 24 * 7;

    const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
    const isProduction = process.env.NODE_ENV === "production" || isHttps;

    res.cookie("sid", session._id.toString(), {
      httpOnly: true,
      signed: true,
      maxAge: sessionExpiryTime,
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction,
    });

    res.clearCookie(guestCookieName, {
      httpOnly: true,
      signed: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
    });

    const guestId = req.headers["x-guest-id"] || req.body?.guestId || req.signedCookies?.[guestCookieName];
    if (guestId) {
      const io = req.app.get("io");
      if (io) {
        const guestRoom = `guest:${guestId}`;
        const userRoom = `user:${user._id}`;
        try {
          const sockets = await io.in(guestRoom).fetchSockets();
          for (const s of sockets) {
            s.leave(guestRoom);
            s.join(userRoom);
            s.data.userId = user._id.toString();
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

    console.log("Saved session:", session._id.toString());

    return res.status(200).json({
      message: "logged in",
      token: session._id.toString(),
      sessionId: session._id.toString(),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        plan: user.plans || "free",
        role: user.role || "User",
      },
    });
  } catch (err) {
    console.error("Google Auth Error:", err);
    if (mongooseSession) {
      try {
        await mongooseSession.abortTransaction();
        await mongooseSession.endSession();
      } catch (abortErr) {
        console.error("Error aborting mongoose transaction:", abortErr);
      }
    }
    return res.status(500).json({ message: "Something went wrong during Google authentication" });
  }
};