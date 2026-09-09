import  { europeTtfbQueueEvent, indiaTtfbQueueEvent, usaTtfbQueueEvent } from "../../queue/ttfb.QeventListner.js";

// handlling bullmq queue event when job is complete
export const setupTtfbQueueResult = (io) => {

    handleQueueEvent( indiaTtfbQueueEvent, "india", io );

    handleQueueEvent( europeTtfbQueueEvent, "europe", io );

    handleQueueEvent( usaTtfbQueueEvent, "usa", io );
};
export const handleQueueEvent = (queueEvent, region, io) => {
    try{

     queueEvent.on("completed",  ({ jobId , returnvalue  }) => {   // jobid is given by bullmq when job is completed and result is what we returned


    console.log("ttfb event listningg ", returnvalue ,"jobId", jobId);


    //const result = JSON.parse(returnvalue);

    const roomId = returnvalue.roomId;
    
    
    io.to(roomId).emit("ttfbCompleted", { jobId: jobId, roomId: roomId, result: returnvalue, region: region }); //sending the result to the specific socket room for the completed job

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