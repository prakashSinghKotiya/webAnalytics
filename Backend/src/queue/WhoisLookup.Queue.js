import { Queue } from "bullmq";
import { sharedRedisConnection } from "../config/redis.js";

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1000,
  },
  removeOnComplete: { age: 60, count: 1000 },
  removeOnFail: { age: 60, count: 1000 },
};

export const whoisLookup = new Queue("whoisLookup-queue", {
  connection: sharedRedisConnection,
  defaultJobOptions,
});

export const whoisLookupQueue = whoisLookup;

const attachQueueErrorHandler = (queue, name) => {
  queue.on("error", (err) => {
    console.error(`[${name}] Queue Error:`, err);
  });
};

attachQueueErrorHandler(whoisLookup, "whoisLookup-queue");

export default whoisLookup;
