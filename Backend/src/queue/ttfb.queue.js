import { Queue } from "bullmq";
import { sharedRedisConnection } from "../config/redis.js";

const defaultJobOptions = {
  attempts: 3, // if job fails, it will be retried 3 times
  backoff: {
    type: "exponential",
    delay: 1000, // delay doubled on each retry (1s, 2s, 4s)
  },
  removeOnComplete: { age: 60, count: 1000 },
  removeOnFail: { age: 60, count: 1000 },
};

export const indiaTtfbQueue = new Queue("ttfb-india", {
    connection: sharedRedisConnection,
    defaultJobOptions,
});

export const europeTtfbQueue = new Queue("ttfb-europe", {
    connection: sharedRedisConnection,
    defaultJobOptions,
});

export const usaTtfbQueue = new Queue("ttfb-usa", {
    connection: sharedRedisConnection,
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


