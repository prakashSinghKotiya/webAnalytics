import { GuestDemoUsage } from "../Models/GuestDemoUsage.Model.js";
import { sharedRedisConnection } from "../config/redis.js";

export const GUEST_DAILY_LIMIT = 6;

export const startOfNextUtcDay = () => {
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0);
  return next;
};

// Atomic Redis Lua Script for reserving guest demo quota:
// Returns:
//   >= 1 (current count) if allowed (<= limit)
//   -1 if daily limit is already exhausted
const RESERVE_QUOTA_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end

if current > tonumber(ARGV[1]) then
    redis.call('DECR', KEYS[1])
    return -1
else
    return current
end
`;

// Atomic Redis Lua Script for releasing an unused reservation
const RELEASE_QUOTA_LUA = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current > 0 then
    return redis.call('DECR', KEYS[1])
else
    return 0
end
`;

/**
 * Centralized guest demo reservation middleware.
 * Enforces a strict overall limit of 6 requests per 24h across all demo services.
 * Completely race-condition free via atomic Redis Lua script + MongoDB atomic conditional fallback.
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

  const day = new Date().toISOString().slice(0, 10);
  const nextReset = startOfNextUtcDay();
  const ttlSeconds = Math.max(60, Math.ceil((nextReset.getTime() - Date.now()) / 1000));
  const redisKey = `guest_demo:usage:${req.guestId}:${day}`;
  const targetUrl = req.targetUrl || req.targetHostname || req.body?.url;

  let currentCount = null;
  let usedRedis = false;

  // 1. Fast path: Atomic check & increment in Redis (guarantees zero race conditions)
  try {
    const redisResult = await sharedRedisConnection.eval(
      RESERVE_QUOTA_LUA,
      1,
      redisKey,
      GUEST_DAILY_LIMIT,
      ttlSeconds
    );

    if (redisResult === -1) {
      return res.status(429).json({
        success: false,
        code: "GUEST_DEMO_LIMIT_EXCEEDED",
        message: `You have reached the daily limit of ${GUEST_DAILY_LIMIT} free demo requests across all services. Please sign in for unlimited access.`,
        limit: GUEST_DAILY_LIMIT,
        remaining: 0,
        nextAvailableAt: nextReset.toISOString(),
      });
    }

    currentCount = Number(redisResult);
    usedRedis = true;
  } catch (redisErr) {
    console.error("[GuestDemoUsage] Redis atomic check error, falling back to MongoDB:", redisErr.message);
  }

  // 2. Persist to MongoDB (audit history) or atomic MongoDB fallback if Redis is down
  const expiresAt = new Date(nextReset.getTime() + 1000 * 60 * 60 * 24); // 24-hour buffer for TTL index

  if (usedRedis && currentCount !== null) {
    // Redis succeeded; sync document in MongoDB in the background
    GuestDemoUsage.findOneAndUpdate(
      { guestId: req.guestId, day },
      {
        $set: { count: currentCount },
        $push: {
          history: {
            service,
            url: targetUrl,
            usedAt: new Date(),
          },
        },
        $setOnInsert: { guestId: req.guestId, day, expiresAt },
      },
      { upsert: true, returnDocument: "after" }
    ).catch((dbErr) => {
      console.error("[GuestDemoUsage] Background MongoDB sync error:", dbErr.message);
    });
  } else {
    // Redis was unavailable: atomic MongoDB conditional update (enforces count < GUEST_DAILY_LIMIT)
    try {
      const usage = await GuestDemoUsage.findOneAndUpdate(
        {
          guestId: req.guestId,
          day,
          count: { $lt: GUEST_DAILY_LIMIT },
        },
        {
          $inc: { count: 1 },
          $push: {
            history: {
              service,
              url: targetUrl,
              usedAt: new Date(),
            },
          },
          $setOnInsert: { guestId: req.guestId, day, expiresAt },
        },
        { upsert: true, returnDocument: "after" }
      );

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

      currentCount = usage.count;
    } catch (err) {
      if (err?.code === 11000) {
        return res.status(429).json({
          success: false,
          code: "GUEST_DEMO_LIMIT_EXCEEDED",
          message: `You have reached the daily limit of ${GUEST_DAILY_LIMIT} free demo requests across all services. Please sign in for unlimited access.`,
          limit: GUEST_DAILY_LIMIT,
          remaining: 0,
          nextAvailableAt: nextReset.toISOString(),
        });
      }
      return next(err);
    }
  }

  // 3. Attach quota information to req for controllers & response payloads
  req.guestDemoUsage = {
    guestId: req.guestId,
    day,
    service,
    redisKey,
  };
  req.guestDemoRemaining = Math.max(0, GUEST_DAILY_LIMIT - currentCount);
  req.guestDemoTotalLimit = GUEST_DAILY_LIMIT;
  req.guestDemoNextAvailableAt = nextReset;

  return next();
};

/**
 * Rollback quota reservation if a request fails validation or queueing.
 */
export const releaseGuestDemoReservation = async (req) => {
  if (!req.guestDemoUsage) return;
  const { guestId, day, redisKey } = req.guestDemoUsage;

  try {
    if (redisKey) {
      await sharedRedisConnection.eval(RELEASE_QUOTA_LUA, 1, redisKey);
    }

    await GuestDemoUsage.findOneAndUpdate(
      { guestId, day, count: { $gt: 0 } },
      {
        $inc: { count: -1 },
        $pop: { history: 1 },
      }
    );
  } catch (err) {
    console.error("[GuestDemoUsage] Error releasing reservation:", err.message);
  }
};
