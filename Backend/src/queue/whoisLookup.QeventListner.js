import { QueueEvents } from "bullmq";
import { queueEventsConn2 } from "../config/redis.js";

export const whoisLookupListener = new QueueEvents("whoisLookup-queue", {
  connection: queueEventsConn2
});


export default whoisLookupListener;
