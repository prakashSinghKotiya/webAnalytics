import mongoose from "mongoose";
import Session from "../Models/Session.Model.js";
import User from "../Models/User.Model.js";

export default async function checkAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    const sid = req.signedCookies?.sid || bearerToken || req.headers["x-session-id"];

    if (!sid || !mongoose.Types.ObjectId.isValid(sid)) {
      return res.status(401).json({ error: "not logged " });
    }

    const session = await Session.findById(sid);
    if (!session) {
      return res.status(401).json({ error: "not logged " });
    }

    const user = await User.findById(session.userId).lean();
    if (!user || user.deleted) {
      return res.status(401).json({ error: "user not found" });
    }

    req.user = user;
    req.sessionId = session._id.toString();
    next();
  } catch (error) {
    console.error("[checkAuth] Middleware error:", error);
    return res.status(500).json({ error: "Internal authentication error" });
  }
}



export const adminChecker = (req, res , next )=>{ 
    if(req.user.role !== "User") return next()
       res.status(403).json({ error: "You can not access users" });

}

export const isAdmin = (req, res , next )=>{  // rbac mw power onlny for amdmin
    if(req.user.role !== "Admin") return next()
       res.status(403).json({ error: "You can not access users" }); 

}