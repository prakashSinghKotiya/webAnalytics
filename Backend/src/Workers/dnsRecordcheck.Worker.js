import { Worker } from "bullmq";
import connection from "../config/redis.js"

import { checkDnsRecords } from "../Services/dnsRecordtype.Service.js";
import { dnsRecordCheckListener } from "../queue/dnsRecordCheck.Queue.js";


const dnsRecordCheck = new Worker("dnsRecordCheck-queue" , async (job) => {
    console.log("Processing dnsRecordCheck for :", job.data);

    if (job.name !== "dnsRecordCheck-queue" ) { return;  }

    const {targetUrl , roomId} = job.data
    if(!targetUrl || !roomId) {
        throw new Error(`Invalid job data. MonitorId: ${targetUrl} , roomId : ${roomId} `); }   



    try{

        const result =  await checkDnsRecords(targetUrl)
         if(!result ||  !result.success ) {return { status : "failed" }}
        console.log("lighthouse result : ", result)

        return {...result , roomId} 

    }catch(err){
        console.log(err)
        throw new Error(`DnsRecordCheck job failed: ${err.message}`)
    }


},{
    connection,
    concurrency :10 ,
}) 



    dnsRecordCheck.on("failed", (job, error) => {

     console.error(`DnsRecordCheck job ${job?.id} failed:`, error.message );

            });


    dnsRecordCheck.on("error", (error) => { 
        console.error( "DnsRecordCheck worker error:", error ); });


 process.on('SIGINT', async () => {
    console.log("Shutting down worker safely...");
    dnsRecordCheck.removeAllListeners()
    await dnsRecordCheck.close();
    await dnsRecordCheckListener.close();  //clear all listeners
    process.exit(0);
});       


export default dnsRecordCheck;