import Redis from "ioredis";

export const redisConnectionOptions = {
  host: process.env.REDIS_HOST ,
  port: Number(process.env.REDIS_PORT ),
  username: process.env.REDIS_USERNAME ,
  password: process.env.REDIS_PASSWORD ,
  tls:{},

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

});

sharedRedisConnection.on("connect", () => {
  console.log("[Redis] Shared client connected");
});

sharedRedisConnection.on("error", (err) => {
  console.error("[Redis] Shared client error:", err.message);
});

// For BullMQ Workers: shared connection is fine (BullMQ duplicates internally for blocking ops)
export const sharedWorkerRedisConnection = sharedRedisConnection;

// QueueEvents requires a dedicated connection per instance (uses XREAD BLOCK).
// Factory creates a new ioredis instance per QueueEvents call — not a persistent shared client.


export const queueEventsConn1 = new Redis({ ...redisConnectionOptions, maxRetriesPerRequest: null });
export const queueEventsConn2 = new Redis({ ...redisConnectionOptions, maxRetriesPerRequest: null });





export const connection = sharedRedisConnection;

export default sharedRedisConnection;
