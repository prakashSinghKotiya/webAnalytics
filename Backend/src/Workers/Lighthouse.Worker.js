import { Worker } from "bullmq";
import connection from "../config/redis.js"

import { runPageSpeed } from "../Services/psInsight.Service.js";


const lightHouseworker = new Worker("lighthouse-queue" , async (job) => {
    console.log("Processing lighthouse for :", job.data);

    if (job.name !== "lighthouse-queue" ) { return;  }

    const {targetUrl , roomId} = job.data

    if (!targetUrl ) { 
        throw new Error(`Invalid job data. MonitorId:  URL: ${targetUrl}`); }


    try{

        const result =  await runPageSpeed(targetUrl)
        if(!result) {return { status : "failed" }}
        console.log("lighthouse result : ", result)

        return {...result , roomId} 

    }catch(err){
        console.log(err)
        throw new Error(`Lighthouse job failed: ${err.message}`)
    }


},{
    connection,
    concurrency :10 ,
}) 



    lightHouseworker.on("failed", (job, error) => {

     console.error(`Uptime job ${job?.id} failed:`, error.message );

            });


    lightHouseworker.on("error", (error) => { 
        console.error( "Uptime worker error:", error ); });


 process.on('SIGINT', async () => {
    console.log("Shutting down worker safely...");
    await lightHouseworker.close();
    lightHouseworker.removeAllListeners();  //clear all listeners
    process.exit(0);
});       


export default lightHouseworker;