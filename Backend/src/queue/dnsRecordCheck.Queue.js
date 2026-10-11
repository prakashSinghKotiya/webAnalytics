import { Queue } from "bullmq";
import { sharedRedisConnection } from "../config/redis.js";

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 1000,
  },
  removeOnComplete: { age: 600, count: 2000 },
  removeOnFail: { age: 1800, count: 2000 },
};

export const dnsRecordCheck = new Queue("dnsRecordCheck-queue", {
  connection: sharedRedisConnection,
  defaultJobOptions,
});

export const dnsRecordQueue = dnsRecordCheck;

const attachQueueErrorHandler = (queue) => {
  queue.on("error", (err) => {
    console.error("[dnsRecordCheck] Queue Error:", err);
  });
};

attachQueueErrorHandler(dnsRecordCheck);

export default dnsRecordCheck;
