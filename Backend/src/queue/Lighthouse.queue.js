import { boss, stopPgBoss } from "./boss.js";

export const LIGHTHOUSE_QUEUE_NAME = "lighthouse-queue";
export const lighthouseQueueName = LIGHTHOUSE_QUEUE_NAME;

// Backward compatibility wrapper for callers that still call Lighthouequeue.add() or Lighthouequeue.getJob()
export const lighthouseQueue = {
  name: LIGHTHOUSE_QUEUE_NAME,
  add: async (nameOrData, maybeData, maybeOptions) => {
    const data = typeof nameOrData === "string" ? maybeData : nameOrData;
    const options = typeof nameOrData === "string" ? maybeOptions : maybeData;
    return boss.send(LIGHTHOUSE_QUEUE_NAME, data, options);
  },
  getJob: async (jobId) => {
    return boss.getJobById(jobId);
  },
};

// Preserve original typo export for existing callers
export const Lighthouequeue = lighthouseQueue;

export const lighthouseQueueEvents = null;

// Call from your SIGTERM/SIGINT handler: waits for running jobs, then closes the pool.
export const stopLighthouseQueue = stopPgBoss;

export { boss };
export default lighthouseQueue;

// BullMQ reference (migrated to pg-boss)
// import { Queue } from "bullmq";
// import { sharedRedisConnection } from "../config/redis.js";
// const defaultJobOptions = {
//   attempts: 3,
//   backoff: { type: "exponential", delay: 1000 },
//   removeOnComplete: { age: 300, count: 500 },
//   removeOnFail: { age: 300, count: 500 },
// };
// export const Lighthouequeue = new Queue("lighthouse-queue", {
//   connection: sharedRedisConnection,
//   defaultJobOptions,
// });
