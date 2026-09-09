import { Worker } from "bullmq";
import connection from "../config/redis.js"
import { measureTTFB } from "../Services/ttfb.Service.js";



export const startTtfbWorker = (region) => {

const queueName = `ttfb-${region}`


const worker = new Worker ( queueName ,  async (job) => {  //listning to ttfb queue for new jobs

    console.log(`Processing TTFB job ${job.id}`);

    const { targetUrl,roomId  } = job.data;

    try{

        const result = await measureTTFB(targetUrl);

        console.log("TTFB result:", result);

        return {region,roomId , ...result}


    }catch (error) {
      console.error("Error processing job:", error);
      throw error;
    }

  },
  {
    connection, //connection to redis and the time there will be new job inside this this worker will start working
    concurrency: 10,
  }
); 


worker.on("completed", (job, result) => {
  console.log(`Job ${job.id} completed`);
  console.log("Result:", result);
});

worker.on("failed", (job, error) => {
  console.error(`Job ${job?.id} failed:`, error.message);
});

}