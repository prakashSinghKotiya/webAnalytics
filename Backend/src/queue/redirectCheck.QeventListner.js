import { QueueEvents } from "bullmq";
import {  queueEventsConn2 } from "../config/redis.js";

export const redirectQueueListener = new QueueEvents("redirect-queue", {
  connection:queueEventsConn2
});

export const redirectQueueEvents = redirectQueueListener;
export default redirectQueueListener;
