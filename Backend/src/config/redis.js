import Redis from "ioredis";

export const redisConnectionOptions = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || process.env.REDIS_port || 6379),
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  keepAlive: 10000,
  connectTimeout: 10000,
  retryStrategy: (times) => Math.min(times * 100, 3000),
};

// Shared Redis client for BullMQ Queue instances (producers) and Worker non-blocking operations.
// BullMQ requires maxRetriesPerRequest: null for blocking/worker compatibility and client reuse.
export const sharedRedisConnection = new Redis({
  ...redisConnectionOptions,
  maxRetriesPerRequest: null,
});

sharedRedisConnection.on("connect", () => {
  console.log("[Redis] Shared client connected");
});

sharedRedisConnection.on("error", (err) => {
  console.error("[Redis] Shared client error:", err.message);
});

// For BullMQ Workers and QueueEvents: export the shared Redis client instance
// so BullMQ reuses it for regular commands and only duplicates for blocking commands.
export const sharedWorkerRedisConnection = sharedRedisConnection;

export const connection = sharedRedisConnection;

export default sharedRedisConnection;
