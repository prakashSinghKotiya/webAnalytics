import { Queue } from "bullmq";
import  { sharedRedisConnection } from "../config/redis.js"


const defaultJobOptions = {
  attempts: 3, 
  backoff: {
    type: "exponential",
    delay: 1000, 
  },
 removeOnComplete: { age: 60, count: 1000 }, 
  removeOnFail: { age: 60, count: 1000 },  
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
