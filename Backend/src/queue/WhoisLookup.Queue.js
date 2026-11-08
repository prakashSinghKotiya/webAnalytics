import { boss } from "./boss.js";

export const WHOIS_QUEUE_NAME = "whoisLookup-queue";
export const whoisLookupQueue = WHOIS_QUEUE_NAME;

// Backward compatibility wrapper for callers that still call whoisLookup.add() or whoisLookup.getJob()
export const whoisLookup = {
  name: WHOIS_QUEUE_NAME,
  add: async (nameOrData, maybeData, maybeOptions) => {
    const data = typeof nameOrData === "string" ? maybeData : nameOrData;
    const options = typeof nameOrData === "string" ? maybeOptions : maybeData;
    return boss.send(WHOIS_QUEUE_NAME, data, options);
  },
  getJob: async (jobId) => {
    return boss.getJobById(jobId);
  },
};

export { boss };
export default whoisLookup;

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
// export const whoisLookup = new Queue("whoisLookup-queue", {
//   connection: sharedRedisConnection,
//   defaultJobOptions,
// });
//
// export const whoisLookupQueue = whoisLookup;
