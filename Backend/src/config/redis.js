import Redis from "ioredis";

const connection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || process.env.REDIS_port || 6379),
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  keepAlive: 10000,
  connectTimeout: 10000,
};

export const sharedRedisConnection = new Redis({
  ...connection,
  maxRetriesPerRequest: 20,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

sharedRedisConnection.on("connect", () => {
  console.log("[Redis] Shared client connected");
});

sharedRedisConnection.on("error", (err) => {
  console.error("[Redis] Shared client error:", err.message);
});

export const sharedWorkerRedisConnection = new Redis({
  ...connection,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

sharedWorkerRedisConnection.on("connect", () => {
  console.log("[Redis] Shared worker client connected");
});

sharedWorkerRedisConnection.on("error", (err) => {
  console.error("[Redis] Shared worker client error:", err.message);
});

export default connection;


// import Redis from "ioredis";

// const connection = {
//   host: process.env.REDIS_HOST || "127.0.0.1",
//   port: Number(process.env.REDIS_PORT || process.env.REDIS_port || 6379),
//   username: process.env.REDIS_USERNAME || undefined,
//   password: process.env.REDIS_PASSWORD || undefined,
//   maxRetriesPerRequest: null,
//   enableReadyCheck: false,
// };

// // Shared Redis client for BullMQ Queue instances (producers)
// // BullMQ allows non-blocking Queue producers to share a single Redis client connection.
// let sharedRedisInstance = null;

// export const getSharedRedisClient = () => {
//   if (!sharedRedisInstance) {
//     sharedRedisInstance = new Redis(connection);

//     sharedRedisInstance.on("error", (err) => {
//       console.error("[Redis] Shared client error:", err.message);
//     });
//   }
//   return sharedRedisInstance;
// };

// export const sharedRedisConnection = getSharedRedisClient();




// export default connection;
