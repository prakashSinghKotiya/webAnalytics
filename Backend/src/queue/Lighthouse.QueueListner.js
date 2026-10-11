import { QueueEvents } from "bullmq";
import {  queueEventsConn2 } from "../config/redis.js";

export const LighthouequeueListner = new QueueEvents("lighthouse-queue", {
  connection: queueEventsConn2
});

export const lighthouseQueueEvents = LighthouequeueListner;
export default LighthouequeueListner;
