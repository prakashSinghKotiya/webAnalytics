import bcrypt from "bcrypt";
import { loginSchema, registerSchema, forgotPasswordSchema } from "../Validators/ZodSchema.js";
import z from "zod";
import { guestCookieName } from "../Middleware/guestDemo.Mw.js";
import { removeUptimeScheduler } from "../Services/uptimeScheduler.Service.js";
import { prisma } from "../config/db.prismaSQL.js";
import { sendOtp } from "../Services/SenddOtp.Service.js";

const isUuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const registerUser = async (req, res, next) => {
  try {
    const { success, data, error } = registerSchema.safeParse(req.body); // sanitizing db inputs

    if (!success) {
      return res.status(400).json({ error: z.flattenError(error).fieldErrors });
    }
    const { email, name, password, otp } = data;

    // 1. Check if user already exists BEFORE verifying/deleting OTP or hashing password
    const userExist = await prisma.user.findUnique({ where: { email } });
    if (userExist) {
      if (userExist.deleted) {
        return res.status(403).json({ error: "your account is deleted contact admin" });
      }
      return res.status(409).json({
        error: "user already exist",
        message: "user already exist",
      });
    }

    // 2. Validate OTP against PostgreSQL oTP model
    const otpRecord = await prisma.oTP.findUnique({ where: { email } });
    if (!otpRecord) {
      return res.status(400).json({ error: "invalid otp" });
    }

    if (otpRecord.attempts >= 5) {
      return res.status(400).json({ error: "too many failed attempts, please request a new otp" });
    }

    if (new Date() > otpRecord.expiresAt) {
      return res.status(400).json({ error: "otp expired, please request a new otp" });
    }

    if (otpRecord.otp !== otp) {
      // Brute-force protection: increment attempts on wrong guess
      await prisma.oTP.update({
        where: { email },
        data: { attempts: { increment: 1 } },
      });
      return res.status(400).json({ error: "invalid otp" });
    }

    // 3. Hash password
    const hashPassword = await bcrypt.hash(password, 12);

    // 4. Atomically delete OTP and create user in a single transaction
    try {
      await prisma.$transaction([
        prisma.oTP.deleteMany({ where: { email } }),
        prisma.user.create({
          data: {
            name,
            email,
            password: hashPassword,
          },
        }),
      ]);

      return res.status(201).json({ message: "User Registered" });
    } catch (err) {
      console.log(err);
      if (err.code === "P2002") {
        // Unique constraint violation (concurrent registration with same email)
        return res.status(409).json({
          error: "user already exist",
          message: "user already exist",
        });
      }
      throw err;
    }
  } catch (err) {
    console.error("registerUser error:", err);
    next(err);
  }
};

/**
 * Handles forgot password and password reset.
 * Matches registerUser flow: validates email, checks OTP against PostgreSQL oTP model,
 * and if valid, hashes the new password and updates the user record atomically.
 */
export const forgotPassword = async (req, res, next) => {
  try {
    const { success, data, error } = forgotPasswordSchema.safeParse(req.body);

    if (!success) {
      return res.status(400).json({ error: z.flattenError(error).fieldErrors });
    }
    const { email, otp, password, newPassword } = data;
    const newPass = password || newPassword;
    const normalizedEmail = email.trim().toLowerCase();

    // 1. Check if user exists BEFORE checking OTP
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(404).json({ error: "User not found with this email" });
    }

    if (user.deleted) {
      return res.status(403).json({ error: "your account is deleted contact admin" });
    }

    // 2. Validate OTP against PostgreSQL oTP model
    const otpRecord = await prisma.oTP.findUnique({ where: { email: normalizedEmail } });
    if (!otpRecord) {
      return res.status(400).json({ error: "invalid otp" });
    }

    if (otpRecord.attempts >= 5) {
      return res.status(400).json({ error: "too many failed attempts, please request a new otp" });
    }

    if (new Date() > otpRecord.expiresAt) {
      return res.status(400).json({ error: "otp expired, please request a new otp" });
    }

    if (otpRecord.otp !== otp) {
      // Brute-force protection: increment attempts on wrong guess
      await prisma.oTP.update({
        where: { email: normalizedEmail },
        data: { attempts: { increment: 1 } },
      });
      return res.status(400).json({ error: "invalid otp" });
    }

    // 3. If password / newPassword is provided, reset it
    if (newPass) {
      const hashPassword = await bcrypt.hash(newPass, 12);

      // Atomically delete OTP, update user password, and invalidate existing sessions
      await prisma.$transaction([
        prisma.oTP.deleteMany({ where: { email: normalizedEmail } }),
        prisma.user.update({
          where: { id: user.id },
          data: { password: hashPassword },
        }),
        prisma.session.deleteMany({ where: { userId: user.id } }),
      ]);

      // Disconnect user's active sockets if any
      const io = req.app.get("io");
      if (io) {
        try {
          io.in(`user:${user.id}`).disconnectSockets(true);
        } catch (sockErr) {
          console.warn(`[forgotPassword] Could not disconnect sockets for user ${user.id}:`, sockErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: "Password reset successfully. Please log in with your new password.",
      });
    }

    // 4. If password was not provided, return OTP verified status (granting access to reset screen)
    return res.status(200).json({
      success: true,
      valid: true,
      message: "OTP verified. You can now reset your password.",
    });
  } catch (err) {
    console.error("forgotPassword error:", err);
    next(err);
  }
};

export const resetPassword = forgotPassword;

/**
 * Sends a password reset OTP to an existing user's registered email.
 * Verifies that the account exists and is not deleted before sending the OTP.
 */
export const sendForgotPasswordOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ error: "Email is required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(404).json({ error: "User not found with this email" });
    }

    if (user.deleted) {
      return res.status(403).json({ error: "Your account is deleted, contact admin" });
    }

    const result = await sendOtp(normalizedEmail);
    return res.status(200).json(result);
  } catch (err) {
    console.error("sendForgotPasswordOtp error:", err);
    next(err);
  }
};

export const loginUser = async (req, res, next) => {
  try {
    const { success, data, error } = loginSchema.safeParse(req.body); // sanitizing db inputs

    if (!success) {
      console.log(error);
      return res.status(400).json({ error: z.flattenError(error).fieldErrors });
    }
    const { email, password } = data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "Invalid Credentials" });
    }

    if (user.deleted) {
      // Soft delete check
      return res.status(403).json({ error: "your account is deleted contact admin" });
    }

    // Password is nullable in postgres (e.g. accounts without a password), bcrypt.compare throws on null
    const ispassValid = user.password ? await bcrypt.compare(password, user.password) : false;
    if (!ispassValid) {
      return res.status(404).json({ error: "Invalid Credentials" });
    }

    // Limit active sessions: keep at most 1 existing live session so adding the new one makes at most 2
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

    const session = await prisma.session.create({ data: { userId: user.id } });
    const sessionExpiryTime = 60 * 1000 * 60 * 24 * 7;

    res.cookie("sid", session.id, {
      httpOnly: true,
      signed: true,
      maxAge: sessionExpiryTime,
      sameSite: "none",
      secure: true,
    });

    // Clear guest cookie on login so the client is no longer in guest mode
    res.clearCookie(guestCookieName, {
      httpOnly: true,
      signed: true,
      sameSite: "none",
      secure: true,
    });

    // If an existing socket was connected under this guest session, migrate it to the user room
    const guestId = req.headers["x-guest-id"] || req.body?.guestId || req.signedCookies?.[guestCookieName];
    if (guestId) {
      const io = req.app.get("io");
      if (io) {
        const guestRoom = `guest:${guestId}`;
        const userRoom = `user:${user.id}`;
        try {
          const sockets = await io.in(guestRoom).fetchSockets(); // fetch all sockets inside the guest room
          for (const s of sockets) {
            s.leave(guestRoom); // migrating guest to user room
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

    return res.json({
      message: "logged in",
      token: session.id,
      sessionId: session.id,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        plan: user.plans || "free",
        role: user.role || "User",
      },
    });
  } catch (err) {
    console.error("loginUser error:", err);
    next(err);
  }
};

export const userDetails = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, picture: true, plans: true, role: true, deleted: true },
    });

    if (!user || user.deleted) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({
      id: user.id,
      name: user.name,
      email: user.email,
      picture: user.picture,
      plan: user.plans || "free",
      role: user.role || "User",
    });
  } catch (error) {
    next(error);
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const where = { deleted: false };

    // Search query: case-insensitive match on name or email, or exact match on numeric ID
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (search) {
      const parsedId = parseInt(search, 10);
      const searchConditions = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
      if (!Number.isNaN(parsedId) && String(parsedId) === search) {
        searchConditions.push({ id: parsedId });
      }
      where.OR = searchConditions;
    }

    // Role filter: 'Admin', 'SuperAdmin', or 'User'
    if (req.query.role && req.query.role !== "all") {
      const roleStr = String(req.query.role).toLowerCase();
      if (roleStr === "admin") {
        where.role = "Admin";
      } else if (roleStr === "superadmin" || roleStr === "super_admin") {
        where.role = "SuperAdmin";
      } else if (roleStr === "user") {
        where.role = "User";
      }
    }

    // Plan filter: 'free' or 'pro'
    if (req.query.plan && req.query.plan !== "all") {
      const planStr = String(req.query.plan).toLowerCase();
      if (planStr === "free") {
        where.plans = "free";
      } else if (planStr === "pro" || planStr === "enterprise") {
        where.plans = "pro";
      }
    }

    // Dynamic sort
    const allowedSortFields = ["id", "name", "email", "role", "createdAt"];
    const sortBy = req.query.sortBy && allowedSortFields.includes(req.query.sortBy)
      ? req.query.sortBy
      : "id";
    const sortOrder = (req.query.sortOrder || req.query.order || "").toLowerCase() === "desc"
      ? "desc"
      : (sortBy === "id" ? "asc" : "desc");

    const [users, totalUsers] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          plans: true,
          picture: true,
          createdAt: true,
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    const totalPages = Math.ceil(totalUsers / limit) || 0;

    // Normalize each user to provide id, _id, plan, and plans for universal compatibility
    const formattedUsers = users.map((u) => ({
      ...u,
      _id: u.id,
      plan: u.plans || "free",
    }));

    return res.status(200).json({
      success: true,
      data: formattedUsers,
      users: formattedUsers,
      pagination: {
        currentPage: page,
        totalPages,
        totalUsers,
        total: totalUsers,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching users.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const adminPowerlogout = async (req, res, next) => { // rbac
  try {
    const id = parseInt(req.params.userId, 10); // userId is an Int in postgres, url params arrive as strings
    if (Number.isNaN(id) || id <= 0) {
      return res.status(400).json({ error: "invalid user id" });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, deleted: true },
    });
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Role boundaries:
    // Only a SuperAdmin can force logout a SuperAdmin
    if (targetUser.role === "SuperAdmin" && req.user?.role !== "SuperAdmin") {
      return res.status(403).json({ error: "Access denied: Cannot force logout a SuperAdmin" });
    }

    // An ordinary Admin cannot force logout another Admin
    if (targetUser.role === "Admin" && req.user?.role !== "SuperAdmin" && req.user?.id !== targetUser.id) {
      return res.status(403).json({ error: "Access denied: Only a SuperAdmin can force logout another Admin" });
    }

    await prisma.session.deleteMany({ where: { userId: id } });

    // Disconnect user's active sockets if any
    const io = req.app.get("io");
    if (io) {
      try {
        io.in(`user:${id}`).disconnectSockets(true);
      } catch (sockErr) {
        console.warn(`[adminPowerlogout] Could not disconnect sockets for user ${id}:`, sockErr.message);
      }
    }

    return res.status(204).end();
  } catch (error) {
    next(error);
  }
};

export const DeleteUser = async (req, res, next) => { // rbac
  const userId = parseInt(req.params.userId, 10); // userId is an Int in postgres, url params arrive as strings
  if (Number.isNaN(userId) || userId <= 0) {
    return res.status(400).json({ error: "invalid user id" });
  }
  if (req.user?.id === userId) { // disabling self delete
    return res.status(403).json({ error: "you cannot delete yourself" });
  }

  try {
    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }
    if (targetUser.deleted) {
      return res.status(400).json({ error: "User is already deleted" });
    }

    // Role boundaries:
    // 1. SuperAdmin accounts cannot be deleted via standard admin endpoints
    if (targetUser.role === "SuperAdmin") {
      return res.status(403).json({ error: "Access denied: SuperAdmin accounts cannot be deleted through ordinary admin endpoints" });
    }

    // 2. An ordinary Admin cannot delete another Admin (only SuperAdmin has permission)
    if (targetUser.role === "Admin" && req.user?.role !== "SuperAdmin") {
      return res.status(403).json({ error: "Access denied: Only a SuperAdmin can delete an Admin account" });
    }

    // One transaction: delete sessions and soft delete user
    await prisma.$transaction([
      prisma.session.deleteMany({ where: { userId } }),
      prisma.user.update({ where: { id: userId }, data: { deleted: true } }), // soft delete
    ]);

    // Disconnect user's active sockets if any
    const io = req.app.get("io");
    if (io) {
      try {
        io.in(`user:${userId}`).disconnectSockets(true);
      } catch (sockErr) {
        console.warn(`[DeleteUser] Could not disconnect sockets for user ${userId}:`, sockErr.message);
      }
    }

    // Pause and remove schedulers for user's active monitors
    try {
      const activeMonitors = await prisma.uptimeMonitor.findMany({ where: { userId, status: "active" } });
      for (const monitor of activeMonitors) {
        await removeUptimeScheduler(monitor.id, `user:${userId}`);
        await prisma.uptimeMonitor.update({ where: { id: monitor.id }, data: { status: "paused" } });
      }
    } catch (schedErr) {
      console.warn(`[DeleteUser] Could not pause schedulers for user ${userId}:`, schedErr.message);
    }

    return res.status(200).json({
      success: true,
      message: "User deleted and active monitors paused successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    const sid = req.sessionId || req.signedCookies?.sid || bearerToken || req.headers["x-session-id"];

    // Delete returns the removed row; P2025 = session already gone (expired / double logout) -> treat as null
    const session = sid && isUuid(sid)
      ? await prisma.session.delete({ where: { id: sid } }).catch((err) => {
          if (err.code === "P2025") return null;
          throw err;
        })
      : null;

    const targetUserId = session?.userId || req.user?.id;
    const io = req.app.get("io");
    if (targetUserId && io) {
      try {
        io.in(`user:${targetUserId}`).disconnectSockets(true);
      } catch (err) {
        console.error("[Socket] Error disconnecting user sockets on logout:", err);
      }
    }
  } catch (err) {
    console.error("[logout] Error during logout:", err);
  } finally {
    res.clearCookie("sid", {
      httpOnly: true,
      signed: true,
      sameSite: "none",
      secure: true,
    });
    res.clearCookie(guestCookieName, {
      httpOnly: true,
      signed: true,
      secure: true,
      sameSite: "none",
    });
    res.status(204).end();
  }
};
