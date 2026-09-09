import { Queue } from "bullmq";
import connection from "../config/redis.js"

const defaultJobOptions = {
  attempts: 3, //if job fails, it will be retried 3 times
  backoff: {
    type: "exponential",
    delay: 1000, // after every retry delay will be doubled (1s, 2s, 4s)
  },
  removeOnComplete: true, 
  removeOnFail: 20, //  latest 20 failed jobs will be kept in Redis for debugging purposes. Older failed jobs will be removed automatically.
};


export const uptimeMonitorQueue = new Queue("uptimeRobot-india", {  //creating a queue named ttfb-india
    connection,
    defaultJobOptions,
});




const attachQueueErrorHandler = (queue, region) => {  //error handler for queue errors
    queue.on("error", (err) => {
        console.error(`[${region}] Queue Error:`, err);
    });
};

attachQueueErrorHandler(uptimeMonitorQueue, "india");



