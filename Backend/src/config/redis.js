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

// Shared Redis client for BullMQ Queue instances (producers)
// BullMQ allows non-blocking Queue producers to share a single Redis client connection.
export const sharedRedisConnection = new Redis({
  ...redisConnectionOptions,
  maxRetriesPerRequest: 20,
});

sharedRedisConnection.on("connect", () => {
  console.log("[Redis] Shared client connected");
});

sharedRedisConnection.on("error", (err) => {
  console.error("[Redis] Shared client error:", err.message);
});

// For BullMQ Workers and QueueEvents: provide connection options so BullMQ
// manages dedicated, unblocked connections for each worker and event listener.
export const sharedWorkerRedisConnection = redisConnectionOptions;

export const connection = redisConnectionOptions;

export default redisConnectionOptions;
