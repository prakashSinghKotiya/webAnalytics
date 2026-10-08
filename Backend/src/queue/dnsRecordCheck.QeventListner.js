import { QueueEvents } from "bullmq";
import { sharedWorkerRedisConnection } from "../config/redis.js";

export const dnsRecordCheckListener = new QueueEvents("dnsRecordCheck-queue", {
  connection: sharedWorkerRedisConnection,
});

export const dnsRecordQueueEvents = dnsRecordCheckListener;
export default dnsRecordCheckListener;

