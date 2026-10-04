import { Worker } from "bullmq";
import connection from "../config/redis.js"

import { checkRDAPLookup } from "../Services/WhoisLookup.Service.js";
import { whoisLookupListener } from "../queue/WhoisLookup.Queue.js";


const whoisLookUp = new Worker("whoisLookup-queue" , async (job) => {
    console.log("Processing whoisLookUp for :", job.data);

    if (job.name !== "whoisLookup-queue" ) { return;  }

    const {targetUrl , roomId} = job.data
    if(!targetUrl || !roomId) {
        throw new Error(`Invalid job data.: ${targetUrl} , roomId : ${roomId} `); }   



    try{

        const result =  await checkRDAPLookup(targetUrl)
        if(!result ||  !result.success ) {return { status : "failed" }}
        console.log("whoisLookUp result : ", result)

        return {...result , roomId} 

    }catch(err){
        console.log(err)
        throw new Error(`whoisLookUp job failed: ${err.message}`)
    }


},{
    connection: { ...connection },
    concurrency :10 ,
}) 



    whoisLookUp.on("failed", (job, error) => {

     console.error(`whoisLookUp job ${job?.id} failed:`, error.message );

            });


    whoisLookUp.on("error", (error) => { 
        console.error( "whoisLookUp worker error:", error ); });


 process.on('SIGINT', async () => {
    console.log("Shutting down worker safely...");
    whoisLookUp.removeAllListeners()
    await whoisLookupListener.close();  //clear all listeners
    await whoisLookUp.close();
    
    process.exit(0);
});       


export default whoisLookUp;