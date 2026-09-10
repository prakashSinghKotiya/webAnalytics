import { indiaUptimeRobotEvent } from "../../queue/uptime.QeventListner";



 export const UptimeRobotEventHandler = (io  )=> {

    UptimeRobotEventResult(indiaUptimeRobotEvent , io)
        
    }




export const UptimeRobotEventResult = (event, io )=> {
 try{

    event.on("completed",  ({ jobId , returnvalue  }) => {   // jobid is given by bullmq when job is completed and result is what we returned
   
        console.log("ttfb event listningg  RESULT :", returnvalue ,"jobId", jobId);
        const monitorid = returnvalue?.monitorId; 
   
        const roomId = `uptime-monitor:${monitorid}`;
   
        io.to(roomId).emit("uptimeCompleted", { jobId: jobId, roomid: roomId, result: returnvalue }); //sending the result to the specific socket room for the completed job

    
        console.log(" ttfbCompleted emitted" , jobId, "to room" , roomId);

})
    }catch(e){
        console.log("Error in handleQueueEvent", e);
        return res.status(500).json({
            success: false,
            message: "Failed to handle queue event",
          });
    }
    }



