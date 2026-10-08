import { QueueEvents } from "bullmq";
import { sharedWorkerRedisConnection } from "../config/redis.js";

export const whoisLookupListener = new QueueEvents("whoisLookup-queue", {
  connection: sharedWorkerRedisConnection,
});

export const whoisLookupQueueEvents = whoisLookupListener;
export default whoisLookupListener;

