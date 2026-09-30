import { Queue, QueueEvents } from "bullmq";
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

export const dnsRecordCheck = new Queue("dnsRecordCheck-queue" , {
    connection,
    defaultJobOptions
})



//queue event listner 
export const dnsRecordCheckListener = new QueueEvents("dnsRecordCheck-queue" , {
    connection
})




const attachQueueErrorHandler = (queue, region) => {  
    queue.on("error", (err) => {
        console.error(`[${region}] Queue Error:`, err);
    });
};

attachQueueErrorHandler(dnsRecordCheck, "india");
