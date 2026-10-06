import { Queue, QueueEvents } from "bullmq";
import { sharedRedisConnection, sharedWorkerRedisConnection } from "../config/redis.js";

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1000,
  },
  removeOnComplete: { age: 60, count: 1000 },
  removeOnFail: { age: 60, count: 1000 },
};

export const redirectQueue = new Queue("redirect-queue", {
  connection: sharedRedisConnection,
  defaultJobOptions,
});

// Queue event listener
export const redirectQueueListener = new QueueEvents("redirect-queue", {
  connection: sharedWorkerRedisConnection,
});

export const redirectQueueEvents = redirectQueueListener;

const attachQueueErrorHandler = (queue, name) => {
  queue.on("error", (err) => {
    console.error(`[${name}] Queue Error:`, err);
  });
};

attachQueueErrorHandler(redirectQueue, "redirect-queue");
attachQueueErrorHandler(redirectQueueListener, "redirect-queue-events");

