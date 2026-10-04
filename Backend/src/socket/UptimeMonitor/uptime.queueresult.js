import { indiaUptimeRobotEvent } from "../../queue/uptime.QeventListner.js"
import { uptimeMonitorQueue } from "../../queue/uptime.queue.js"



 export const UptimeRobotEventHandler = (io  )=> {

    UptimeRobotEventResult( indiaUptimeRobotEvent , io)
        
    }



export const UptimeRobotEventResult = (event, io )=> {
 try{

    event.on("completed",  ({ jobId , returnvalue  }) => {   // jobid is given by bullmq when job is completed and result is what we returned
   
        console.log("uptime event listningg  RESULT :", returnvalue ,"jobId", jobId);
        const userRoom = returnvalue?.roomId; 
      //  const userRoom = `user:${roomId}`;
   
   
        io.to(userRoom).emit("uptimeCompleted", { jobId: jobId, roomid: userRoom, result: returnvalue }); //sending the result to the specific socket room for the completed job

    
        console.log(" ttfbCompleted emitted" , jobId, "to room" , userRoom); })



        
                 event.on("failed", async({ jobId, failedReason }) => {
        
                    console.log(`whoisLookup job ${jobId} failed`);
        
                    const job = await uptimeMonitorQueue.getJob(jobId)
                     const userRoom = job?.data?.roomId;
                    // const userRoom = `user:${roomId}`
        
                    console.log("Reason:", failedReason);
        
                    io.to(userRoom).emit("uptimeMonitor-failed", {
                        jobId,
                        error: failedReason
                    });
                });


    }catch(e){
        console.log("Error in handleQueueEvent", e);
      
    }
    }



