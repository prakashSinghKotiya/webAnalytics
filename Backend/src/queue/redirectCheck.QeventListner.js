import { QueueEvents } from "bullmq";
import { sharedWorkerRedisConnection } from "../config/redis.js";

export const redirectQueueListener = new QueueEvents("redirect-queue", {
  connection: sharedWorkerRedisConnection,
});

export const redirectQueueEvents = redirectQueueListener;
export default redirectQueueListener;

