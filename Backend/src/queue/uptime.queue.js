import { Queue } from "bullmq";
import { sharedRedisConnection } from "../config/redis.js";

const defaultJobOptions = {
  attempts: 3, //if job fails, it will be retried 3 times
  backoff: {
    type: "exponential",
    delay: 1000, // after every retry delay will be doubled (1s, 2s, 4s)
  },
  removeOnComplete: { age: 60, count: 1000 }, 
  removeOnFail: { age: 60, count: 1000 },
};

export const uptimeMonitorQueue = new Queue("uptimeRobot-india", {
    connection: sharedRedisConnection,
    defaultJobOptions,
});

// await uptimeMonitorQueue.obliterate({ force: true });
// console.log("Uptime queue cleared");



const attachQueueErrorHandler = (queue, region) => {  //error handler for queue errors
    queue.on("error", (err) => {
        console.error(`[${region}] Queue Error:`, err);
    });
};

attachQueueErrorHandler(uptimeMonitorQueue, "india");



