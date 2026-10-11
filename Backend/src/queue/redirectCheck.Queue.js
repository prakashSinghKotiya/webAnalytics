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

export const redirectQueue = new Queue("redirect-queue", {
  connection: sharedRedisConnection,
  defaultJobOptions,
});

export const redirectQueueEvents = null;

const attachQueueErrorHandler = (queue, name) => {
  queue.on("error", (err) => {
    console.error(`[${name}] Queue Error:`, err);
  });
};

attachQueueErrorHandler(redirectQueue, "redirect-queue");

export default redirectQueue;
