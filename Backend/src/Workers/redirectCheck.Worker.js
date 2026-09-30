import { Worker } from "bullmq";
import connection from "../config/redis.js"
import { redirectQueueListener } from "../queue/redirectCheck.Queue.js";
import { findRedirects } from "../Services/redirectCheck.Service.js";


const redirectCheck = new Worker("redirect-queue" , async (job) => {
    console.log("Processing dnsRecordCheck for :", job.data);

    if (job.name !== "redirect-queue" ) { return;  }

    const {targetUrl , roomId} = job.data
    if(!targetUrl || !roomId) {
        throw new Error(`Invalid job data.: ${targetUrl} , roomId : ${roomId} `); }   



    try{

        const result =  await findRedirects(targetUrl)
        if(!result ||  !result.success ) {return { status : "failed" }}
        console.log("redirectCheck result : ", result)

        return {...result , roomId} 

    }catch(err){
        console.log(err)
        throw new Error(`redirectCheck job failed: ${err.message}`)
    }


},{
    connection,
    concurrency :10 ,
}) 



    redirectCheck.on("failed", (job, error) => {

     console.error(`redirectCheck job ${job?.id} failed:`, error.message );

            });


    redirectCheck.on("error", (error) => { 
        console.error( "redirectCheck worker error:", error ); });


 process.on('SIGINT', async () => {
    console.log("Shutting down worker safely...");
    redirectCheck.removeAllListeners()
    await redirectQueueListener.close();  //clear all listeners
    await redirectCheck.close();
    
    process.exit(0);
});       


export default redirectCheck;