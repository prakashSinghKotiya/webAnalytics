import { Queue } from "bullmq";
import connection from "../config/redis.js"


const defaultJobOptions = {
  attempts: 3, 
  backoff: {
    type: "exponential",
    delay: 1000, 
  },
  removeOnComplete: { age: 60, count: 1000 }, 
  removeOnFail: { age: 60, count: 1000 },  
};

export const whoisLookup = new Queue("whoisLookup-queue" , {
    connection,
    defaultJobOptions
})





//queue event listner 
export const whoisLookupListener = new QueueEvents("whoisLookup-queue" , {
    connection
})




const attachQueueErrorHandler = (queue, region) => {  
    queue.on("error", (err) => {
        console.error(`[${region}] Queue Error:`, err);
    });
};

attachQueueErrorHandler(whoisLookup, "india");
