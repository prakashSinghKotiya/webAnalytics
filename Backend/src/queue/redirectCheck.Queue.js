import { boss } from "./boss.js";

export const REDIRECT_QUEUE_NAME = "redirect-queue";
export const redirectQueueName = REDIRECT_QUEUE_NAME;

// Backward compatibility wrapper for callers that still call redirectQueue.add() or redirectQueue.getJob()
export const redirectQueue = {
  name: REDIRECT_QUEUE_NAME,
  add: async (nameOrData, maybeData, maybeOptions) => {
    const data = typeof nameOrData === "string" ? maybeData : nameOrData;
    const options = typeof nameOrData === "string" ? maybeOptions : maybeData;
    return boss.send(REDIRECT_QUEUE_NAME, data, options);
  },
  getJob: async (jobId) => {
    return boss.getJobById(jobId);
  },
};

export const redirectQueueEvents = null;

export { boss };
export default redirectQueue;

//bullmq
// import { Queue } from "bullmq";
// import { sharedRedisConnection } from "../config/redis.js";
//
// const defaultJobOptions = {
//   attempts: 3,
//   backoff: {
//     type: "exponential",
//     delay: 1000,
//   },
//   removeOnComplete: { age: 300, count: 500 },
//   removeOnFail: { age: 300, count: 500 },
// };
//
// export const redirectQueue = new Queue("redirect-queue", {
//   connection: sharedRedisConnection,
//   defaultJobOptions,
// });
