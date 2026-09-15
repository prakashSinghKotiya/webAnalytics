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


export const indiaTtfbQueue = new Queue("ttfb-india", {  //creating a queue named ttfb-india and now we can add jobs to this queue from controller doing indiaTtfbQueue.add
    connection,
    defaultJobOptions,
});

export const europeTtfbQueue = new Queue("ttfb-europe", {
    connection,
    defaultJobOptions,
});

export const usaTtfbQueue = new Queue("ttfb-usa", {
    connection,
    defaultJobOptions,
});





const attachQueueErrorHandler = (queue, region) => {  //error handler for queue errors
    queue.on("error", (err) => {
        console.error(`[${region}] Queue Error:`, err);
    });
};

attachQueueErrorHandler(indiaTtfbQueue, "india");
attachQueueErrorHandler(europeTtfbQueue, "europe");
attachQueueErrorHandler(usaTtfbQueue, "usa");


