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

export const dnsRecordCheck = new Queue("dnsRecordCheck-queue", {
  connection: sharedRedisConnection,
  defaultJobOptions,
});

export const dnsRecordQueue = dnsRecordCheck;

// Queue event listener
export const dnsRecordCheckListener = new QueueEvents("dnsRecordCheck-queue", {
  connection: sharedWorkerRedisConnection,
});

export const dnsRecordQueueEvents = dnsRecordCheckListener;

const attachQueueErrorHandler = (queue) => {
  queue.on("error", (err) => {
    console.error("[dnsRecordCheck] Queue Error:", err);
  });
};

attachQueueErrorHandler(dnsRecordCheck);
