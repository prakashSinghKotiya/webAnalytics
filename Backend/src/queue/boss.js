import PgBoss from "pg-boss";

// One shared pg-boss instance per process.
// The options below replace BullMQ's `defaultJobOptions` across all migrated services.
export const boss = new PgBoss({
  connectionString: process.env.PGBOSS_DATABASE_URL || process.env.DATABASE_URL,
  max: Number(process.env.PGBOSS_POOL_MAX) || 20, // pg pool size
  application_name: process.env.PGBOSS_APP_NAME || "speed-pgboss",

  // --- default job options (== defaultJobOptions) ---
  retryLimit: 2, // BullMQ attempts: 3 => 1 try + 2 retries
  retryDelay: 1, // seconds
  retryBackoff: true, // exponential: ~1s, 2s, 4s
  expireInSeconds: 90, // keep this ABOVE worker timeouts
  retentionMinutes: 10, // an unprocessed job older than 10m is dropped
  onComplete: true, // creates the completion job that QueueEvents listeners consume

  // --- cleanup (== removeOnComplete / removeOnFail { age: 300 }) ---
  archiveCompletedAfterSeconds: 300,
  archiveFailedAfterSeconds: 300,
  deleteAfterHours: 1,

  // Polling interval (v8 polls Postgres for new jobs)
  newJobCheckInterval: 500, // ms
});

boss.on("error", (err) => console.error("[pg-boss] Error:", err));

// Needs a DIRECT Postgres connection (not PgBouncer transaction mode).
await boss.start();

// Call from your SIGTERM/SIGINT handler: waits for running jobs, then closes the pool.
export const stopPgBoss = () => boss.stop({ graceful: true, timeout: 30000 });

export default boss;

