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

export const whoisLookup = new Queue("whoisLookup-queue", {
  connection: sharedRedisConnection,
  defaultJobOptions,
});

export const whoisLookupQueue = whoisLookup;

// Queue event listener
export const whoisLookupListener = new QueueEvents("whoisLookup-queue", {
  connection: sharedWorkerRedisConnection,
});

export const whoisLookupQueueEvents = whoisLookupListener;

const attachQueueErrorHandler = (queue, name) => {
  queue.on("error", (err) => {
    console.error(`[${name}] Queue Error:`, err);
  });
};

attachQueueErrorHandler(whoisLookup, "whoisLookup-queue");
attachQueueErrorHandler(whoisLookupListener, "whoisLookup-queue-events");

