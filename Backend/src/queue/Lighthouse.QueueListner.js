import { QueueEvents } from "bullmq";
import { sharedWorkerRedisConnection } from "../config/redis.js";

export const LighthouequeueListner = new QueueEvents("lighthouse-queue", {
  connection: sharedWorkerRedisConnection,
});

export const lighthouseQueueEvents = LighthouequeueListner;
export default LighthouequeueListner;