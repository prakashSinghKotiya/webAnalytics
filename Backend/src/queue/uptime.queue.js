import { boss, stopPgBoss } from "./boss.js";

export const UPTIME_QUEUE_NAME = "uptimeRobot-india";
export const uptimeQueueName = UPTIME_QUEUE_NAME;

export const UPTIME_BATCH_QUEUE_NAME = "uptime-batch";
export const uptimeBatchQueueName = UPTIME_BATCH_QUEUE_NAME;

export const UPTIME_DISPATCHER_QUEUE_NAME = "uptime-dispatcher";
export const uptimeDispatcherQueueName = UPTIME_DISPATCHER_QUEUE_NAME;

/**
 * Enqueues a batch of monitor IDs to be checked by a specific runner (or default if null).
 *
 * @param {Array<number>} monitorIds - Array of monitor IDs to check
 * @param {number|null} [runnerId=null] - Runner ID (null for default runner)
 * @param {object} [options={}] - Optional pg-boss job options
 * @returns {Promise<string|null>} pg-boss job ID
 */
export const enqueueUptimeBatch = async (monitorIds, runnerId = null, options = {}) => {
  if (!Array.isArray(monitorIds) || monitorIds.length === 0) {
    return null;
  }

  const payload = {
    monitorIds,
    runnerId: runnerId !== undefined && runnerId !== null ? Number(runnerId) : null,
  };

  const defaultJobOptions = {
    retryLimit: 1,
    retryDelay: 5,
    expireInSeconds: 120,
    ...options,
  };

  return boss.send(UPTIME_BATCH_QUEUE_NAME, payload, defaultJobOptions);
};

export const uptimeBatchQueue = {
  name: UPTIME_BATCH_QUEUE_NAME,
  add: async (nameOrData, maybeData, maybeOptions) => {
    const data = typeof nameOrData === "string" ? maybeData : nameOrData;
    const options = typeof nameOrData === "string" ? maybeOptions : maybeData;
    return boss.send(UPTIME_BATCH_QUEUE_NAME, data, options);
  },
  getJob: async (jobId) => {
    return boss.getJobById(jobId);
  },
};

// Backward compatibility wrapper for callers that still call uptimeMonitorQueue.add() or uptimeMonitorQueue.getJob()
export const uptimeMonitorQueue = {
  name: UPTIME_QUEUE_NAME,
  add: async (nameOrData, maybeData, maybeOptions) => {
    const data = typeof nameOrData === "string" ? maybeData : nameOrData;
    const options = typeof nameOrData === "string" ? maybeOptions : maybeData;
    return boss.send(UPTIME_QUEUE_NAME, data, options);
  },
  getJob: async (jobId) => {
    return boss.getJobById(jobId);
  },
};

export const uptimeQueue = uptimeMonitorQueue;
export const uptimeQueueEvents = null;

// Call from your SIGTERM/SIGINT handler: waits for running jobs, then closes the pool.
export const stopUptimeQueue = stopPgBoss;

export { boss };
export default uptimeMonitorQueue;

// BullMQ reference (migrated to pg-boss)
// import { Queue } from "bullmq";
// import { sharedRedisConnection } from "../config/redis.js";
// const defaultJobOptions = {
//   attempts: 3,
//   backoff: { type: "exponential", delay: 1000 },
//   removeOnComplete: { age: 600, count: 2000 },
//   removeOnFail: { age: 1800, count: 2000 },
// };
// export const uptimeMonitorQueue = new Queue("uptimeRobot-india", {
//   connection: sharedRedisConnection,
//   defaultJobOptions,
// });
