import { boss, stopPgBoss } from "./boss.js";

export const DNS_QUEUE_NAME = "dnsRecordCheck-queue";
export const dnsRecordQueueName = DNS_QUEUE_NAME;

// Backward compatibility wrapper for callers that still call dnsRecordCheck.add() or dnsRecordCheck.getJob()
export const dnsRecordCheck = {
  name: DNS_QUEUE_NAME,
  add: async (nameOrData, maybeData, maybeOptions) => {
    const data = typeof nameOrData === "string" ? maybeData : nameOrData;
    const options = typeof nameOrData === "string" ? maybeOptions : maybeData;
    return boss.send(DNS_QUEUE_NAME, data, options);
  },
  getJob: async (jobId) => {
    return boss.getJobById(jobId);
  },
};

export const dnsRecordQueue = dnsRecordCheck;
export const dnsRecordQueueEvents = null;

// Call from your SIGTERM/SIGINT handler: waits for running jobs, then closes the pool.
export const stopDnsQueue = stopPgBoss;

export { boss };
export default dnsRecordCheck;

// BullMQ reference (migrated to pg-boss)
// import { Queue } from "bullmq";
// import { sharedRedisConnection } from "../config/redis.js";
// const defaultJobOptions = {
//   attempts: 3,
//   backoff: { type: "exponential", delay: 1000 },
//   removeOnComplete: { age: 600, count: 2000 },
//   removeOnFail: { age: 1800, count: 2000 },
// };
// export const dnsRecordCheck = new Queue("dnsRecordCheck-queue", {
//   connection: sharedRedisConnection,
//   defaultJobOptions,
// });
