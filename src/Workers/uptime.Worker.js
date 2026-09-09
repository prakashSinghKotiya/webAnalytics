import {Worker } from "bullmq";
import connection from "../config/redis";
import { checkUrl } from "../Services/uptimeChecker.Service";


const worker = new Worker("uptimeRobot-india", async (job) => { 

        console.log("Processing uptimeMonitor for :", job.data.targeturl);

        if (job.name !== "uptime-scheduler-event") { return;  }

        if (!targeturl || !monitorId) {
        throw new Error(`Invalid job data. MonitorId: ${monitorId}, URL: ${targeturl}`); }

         const {targeturl , monitorId} = job.data

          try{

        const result = await checkUrl(targeturl)
        console.log("uptimeMonitor result:", result);

        return {monitorId, targeturl , ...result}


    }catch (error) {
        console.log(`monitorid :${monitorId}failed ` , error)
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
    );

});




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