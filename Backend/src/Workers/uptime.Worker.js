import {Worker } from "bullmq";
import connection from "../config/redis.js";
import { checkUrl } from "../Services/uptimeChecker.Service.js";


const worker = new Worker("uptimeRobot-india", async (job) => { 

        console.log("Processing uptimeMonitor for :", job.data);

        if (job.name !== "uptime-scheduler-event") { return;  }

        

    
         const {url , roomId} = job.data
         
         if (!url || !roomId) { 
        throw new Error(`Invalid job data. roomId: ${roomId}, URL: ${url}`); }

          try{

        const result = await checkUrl(url)
        console.log("uptimeMonitor result:", result);

        return {roomId, url , ...result}


    }catch (error) {
        console.log(`roomId :${roomId}failed ` , error)
        throw error
    }  
},
    
    {
        connection ,
        concurrency: 10
    } )


 worker.on("completed", (job) => {

    console.log(
        `Uptime job ${job.id} completed`
    );});




    worker.on("failed", (job, error) => {

     console.error(`Uptime job ${job?.id} failed:`, error.message );

            });


    worker.on("error", (error) => { 
        console.error( "Uptime worker error:", error ); });


 process.on('SIGINT', async () => {
    console.log("Shutting down worker safely...");
    await worker.close();
    worker.removeAllListeners();  //clear all listeners
    process.exit(0);
});       


export default worker;