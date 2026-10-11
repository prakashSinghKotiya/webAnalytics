import { Queue } from "bullmq";
import  { sharedRedisConnection } from "../config/redis.js"


const defaultJobOptions = {
  attempts: 3, 
  backoff: {
    type: "exponential",
    delay: 1000, 
  },
  removeOnComplete: { age: 300, count: 500 },
  removeOnFail: { age: 300, count: 500 },
};

export const Lighthouequeue = new Queue("lighthouse-queue", {
  connection: sharedRedisConnection,
  defaultJobOptions,
});

export const lighthouseQueue = Lighthouequeue;

const attachQueueErrorHandler = (queue) => {
  queue.on("error", (err) => {
    console.error("[Lighthouse] Queue Error:", err);
  });
};

attachQueueErrorHandler(Lighthouequeue);
