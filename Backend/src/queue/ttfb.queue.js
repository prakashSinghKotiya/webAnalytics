import { boss, stopPgBoss } from "./boss.js";

export const ttfbQueues = {
  india: "ttfb-india",     // equivalent to new Queue("ttfb-india",)      
  canada: "ttfb-canada",
  singapore: "ttfb-singapore",
};

// One shared pg-boss instance per process
export { boss };

// Call from your SIGTERM/SIGINT handler: waits for running jobs, then closes the pool.
export const stopTtfbQueue = stopPgBoss;

//bullmq reference
// import { Queue } from "bullmq";
// import { sharedRedisConnection } from "../config/redis.js";
// const defaultJobOptions = {
//   attempts: 3,
//   backoff: { type: "exponential", delay: 1000 },
//   removeOnComplete: { age: 300, count: 500 },
//   removeOnFail: { age: 300, count: 500 },
// };
