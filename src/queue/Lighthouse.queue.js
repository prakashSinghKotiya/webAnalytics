import { Queue } from "bullmq";
import connection from "../config/redis.js"


const defaultJobOptions = {
  attempts: 3, 
  backoff: {
    type: "exponential",
    delay: 1000, 
  },
  removeOnComplete: true, 
  removeOnFail: 20,  
};

export const Lighthouequeue = new Queue("lighthouse-queue" , {
    connection,
    defaultJobOptions
})




const attachQueueErrorHandler = (queue, region) => {  
    queue.on("error", (err) => {
        console.error(`[${region}] Queue Error:`, err);
    });
};

attachQueueErrorHandler(Lighthouequeue, "india");
