import crypto from "node:crypto";
import { prisma } from "../config/db.prismaSQL.js";

export const GUEST_DAILY_LIMIT = 6;

export const startOfNextUtcDay = () => {
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0);
  return next;
};

/**
 * Centralized guest demo reservation middleware.
 * Enforces a strict overall limit of 6 requests per 24h across all demo services.
 * Completely race-condition free via PostgreSQL atomic transaction with row-level conditional locks.
 */
export const reserveGuestDemo = (service) => async (req, res, next) => {
  // Authenticated users bypass demo limits entirely
  if (req.user) return next();

  if (!req.guestId) {
    return res.status(401).json({
      success: false,
      code: "GUEST_SESSION_REQUIRED",
      message: "Guest session required. Please initialize a demo session first.",
    });
  }

  const reservationId = crypto.randomUUID();
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const nextReset = startOfNextUtcDay();
  const expiresAt = new Date(nextReset.getTime() + 1000 * 60 * 60 * 24); // 24-hour buffer for retention cleanup
  const targetUrl = req.targetUrl || req.targetHostname || req.body?.url;

  try {
    const usage = await prisma.$transaction(async (tx) => {
      // 1. Ensure today's row exists for this guest (idempotent insert)
      await tx.guestDemoUsage.createMany({
        data: [{ guestId: req.guestId, day, expiresAt }],
        skipDuplicates: true,
      });

      // 2. Atomic conditional increment: ensures count < GUEST_DAILY_LIMIT
      // updateMany returns { count: number of rows updated }
      const { count: updatedRows } = await tx.guestDemoUsage.updateMany({
        where: { guestId: req.guestId, day, count: { lt: GUEST_DAILY_LIMIT } },
        data: { count: { increment: 1 } },
      });

      if (updatedRows === 0) {
        return null; // Quota exceeded
      }

      // 3. Record audit history and retrieve the updated count
      return tx.guestDemoUsage.update({
        where: { guestId_day: { guestId: req.guestId, day } },
        data: {
          history: {
            create: {
              reservationId,
              service,
              url: targetUrl,
              usedAt: new Date(),
            },
          },
        },
        select: { count: true },
      });
    });

    if (!usage) {
      return res.status(429).json({
        success: false,
        code: "GUEST_DEMO_LIMIT_EXCEEDED",
        message: `You have reached the daily limit of ${GUEST_DAILY_LIMIT} free demo requests across all services. Please sign in for unlimited access.`,
        limit: GUEST_DAILY_LIMIT,
        remaining: 0,
        nextAvailableAt: nextReset.toISOString(),
      });
    }

    const currentCount = usage.count;

    // 4. Attach quota and reservation information to req for controllers & response payloads
    req.guestDemoUsage = {
      guestId: req.guestId,
      day,
      service,
      reservationId,
    };
    req.guestDemoRemaining = Math.max(0, GUEST_DAILY_LIMIT - currentCount);
    req.guestDemoTotalLimit = GUEST_DAILY_LIMIT;
    req.guestDemoNextAvailableAt = nextReset;

    return next();
  } catch (err) {
    console.error("[GuestDemoUsage] Error in reserveGuestDemo:", err);
    return next(err);
  }
};

/**
 * Rollback quota reservation if a request fails validation or queueing.
 * Uses exact reservationId to remove only the corresponding history item.
 */
export const releaseGuestDemoReservation = async (req) => {
  if (!req?.guestDemoUsage) return;
  const { guestId, day, reservationId } = req.guestDemoUsage;

  try {
    await prisma.$transaction(async (tx) => {
      // Decrement count only if > 0
      const { count: updatedRows } = await tx.guestDemoUsage.updateMany({
        where: { guestId, day, count: { gt: 0 } },
        data: { count: { decrement: 1 } },
      });

      if (updatedRows === 0) return;

      if (reservationId) {
        await tx.guestDemoUsageHistory.deleteMany({
          where: { reservationId, usage: { guestId, day } },
        });
      } else {
        // Fallback: delete most recent history entry
        const last = await tx.guestDemoUsageHistory.findFirst({
          where: { usage: { guestId, day } },
          orderBy: { id: "desc" },
          select: { id: true },
        });
        if (last) {
          await tx.guestDemoUsageHistory.delete({ where: { id: last.id } });
        }
      }
    });
  } catch (err) {
    console.error("[GuestDemoUsage] Error releasing reservation:", err.message);
  }
};

// export default {
//   reserveGuestDemo,
//   releaseGuestDemoReservation,
//   GUEST_DAILY_LIMIT,
//   startOfNextUtcDay,
// };

// export default {
//   reserveGuestDemo,
//   releaseGuestDemoReservation,
//   GUEST_DAILY_LIMIT,
//   startOfNextUtcDay,
// };

