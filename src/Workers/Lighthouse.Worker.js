import { Worker } from "bullmq";
import connection from "../config/redis.js"
import { lighthouseReport } from "../Services/Lighhouse.Service.js";


const lightHouseworker = new Worker("lighthouse-queue" , async (job) => {
    console.log("Processing lighthouse for :", job.data);

    if (job.name !== "lighthouse-queue" ) { return;  }

    const {targetUrl , roomId} = job.data

    if (!url ) { 
        throw new Error(`Invalid job data. MonitorId:  URL: ${url}`); }


    try{

        const data =  await lighthouseReport(targetUrl)
        if(!data) {return { status : "failed" }}

        return {data , roomId}

    }catch(err){
        console.log(err)
        throw new Error
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