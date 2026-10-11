import { Queue } from "bullmq";
import { sharedRedisConnection } from "../config/redis.js";

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1000,
  },
  removeOnComplete: { age: 300, count: 500 },
  removeOnFail: { age: 300, count: 500 },
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
