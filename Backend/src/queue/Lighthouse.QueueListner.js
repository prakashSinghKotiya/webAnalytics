import { QueueEvents } from "bullmq";
import { createQueueEventsConnection } from "../config/redis.js";

export const LighthouequeueListner = new QueueEvents("lighthouse-queue", {
  connection: createQueueEventsConnection(),
});

export const lighthouseQueueEvents = LighthouequeueListner;
export default LighthouequeueListner;
