import Redis from "ioredis";

export const redisConnectionOptions = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD,
  //  tls: {
  //   rejectUnauthorized: false, // Prevents SSL handshake drops on shared hosting
  // },
rejectUnauthorized: false, // Prevents SSL handshake drops on shared hosting
  family: 4, // Force IPv4 (prevents cPanel IPv6 DNS timeout)
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  keepAlive: 30000, // 30s keepAlive is gentler on cloud firewalls than 10s
  connectTimeout: 15000,

  // Safe Retry Strategy: Starts at 2 seconds + random jitter up to 1s, maxes at 15 seconds.
  // Prevents all 6 BullMQ workers from spamming the firewall at the exact same millisecond.
  retryStrategy: (times) => {
    const jitter = Math.floor(Math.random() * 1000);
    const delay = Math.min(times * 2000, 15000);
    return delay + jitter;
  },
};

// Helper function to create Redis clients that NEVER crash Node on error
function createSafeRedisClient(name) {
  const client = new Redis({ ...redisConnectionOptions });

  client.on("connect", () => {
    console.log(`[Redis] ${name} connected`);
  });

  client.on("error", (err) => {
    console.error(`[Redis] ${name} error:`, err.message);
  });

  return client;
}

// 1. Shared Redis client for BullMQ Queue instances (producers)
export const sharedRedisConnection = createSafeRedisClient("SharedClient");

// 2. For BullMQ Workers (BullMQ duplicates internally for blocking ops)
export const sharedWorkerRedisConnection = sharedRedisConnection;

// 3. Dedicated connections for QueueEvents (with error handlers attached!)
export const queueEventsConn1 = createSafeRedisClient("QueueEvents-1");
export const queueEventsConn2 = createSafeRedisClient("QueueEvents-2");

// 4. Graceful Shutdown: Closes old connections cleanly when cPanel restarts the app
const cleanup = async () => {
  console.log("[Redis] Closing connections before shutdown...");
  await Promise.allSettled([
    sharedRedisConnection.quit(),
    queueEventsConn1.quit(),
    queueEventsConn2.quit(),
  ]);
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

export const connection = sharedRedisConnection;
export default sharedRedisConnection;