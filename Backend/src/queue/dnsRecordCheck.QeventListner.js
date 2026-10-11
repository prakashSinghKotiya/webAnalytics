import { QueueEvents } from "bullmq";
import { queueEventsConn2 } from "../config/redis.js";

export const dnsRecordCheckListener = new QueueEvents("dnsRecordCheck-queue", {
  connection: queueEventsConn2
});

export const dnsRecordQueueEvents = dnsRecordCheckListener;
export default dnsRecordCheckListener;
