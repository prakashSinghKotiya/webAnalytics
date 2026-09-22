import  { europeTtfbQueueEvent, indiaTtfbQueueEvent, usaTtfbQueueEvent } from "../../queue/ttfb.QeventListner.js";

// handlling bullmq queue event when job is complete
export const setupTtfbQueueResult = (io) => {

    handleQueueEvent( indiaTtfbQueueEvent, "india", io );

    handleQueueEvent( europeTtfbQueueEvent, "europe", io );

    handleQueueEvent( usaTtfbQueueEvent, "usa", io );
};
export const handleQueueEvent = (queueEvent, region, io) => {
    try{

    queueEvent.on("completed",  ({ jobId, returnvalue  }) => {   // jobid is given by bullmq when job is completed and result is what we returned
    console.log("ttfb event listningg ", returnvalue ,"jobId", jobId);
    const room = returnvalue?.roomId;
    const userRoom = `user:${room}`;
    io.to(userRoom).emit("ttfbCompleted", { jobId: jobId, roomId: roomId, result: returnvalue, region: region }); //sending the result to the specific socket room for the completed job

     console.log(" ttfbCompleted emitted" , jobId, "to room" , roomId);

})
    }catch(e){
        console.log("Error in handleQueueEvent", e);
        
    }



}



// What happens in memory
// When your server starts, setupTtfbQueueResult(io) executes once.

// It runs handleQueueEvent 3 times to register 3 separate listeners:

// Listener 1 subscribes to Redis for the "india" queue stream.
// Listener 2 subscribes to Redis for the "europe" queue stream.
// Listener 3 subscribes to Redis for the "usa" queue stream.

// Once registered, that setup code is finished. Nothing is "running" or "checking."
// once initialized they run for the whole time and run when a job is completed .