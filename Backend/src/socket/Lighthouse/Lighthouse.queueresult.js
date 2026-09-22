import { Lighthouequeue } from "../../queue/Lighthouse.queue.js";
import { LighthouequeueListner } from "../../queue/Lighthouse.QueueListner.js";


export const LighthouseResultHandler =(io) => {

    lighthouseevent(LighthouequeueListner ,io)

}


export const lighthouseevent = (event , io) =>{

    try{
         event.on("completed", ({jobId , returnvalue}) => {
        console.log(`Lighthouse job ${jobId} completed`);
        const room =  returnvalue?.roomId
        const userRoom = `user:${room}`;
        

        io.to(userRoom).emit("Lighthouse-completed", { jobId: jobId, result: returnvalue } )
        
        console.log(`result sent to room: ${room}`)
    

        })



         event.on("failed", async({ jobId, failedReason }) => {

            console.log(`Lighthouse job ${jobId} failed`);

            const job = await Lighthouequeue.getJob(jobId)
             const roomId = job?.data?.roomId;

            console.log("Reason:", failedReason);

            io.to(roomId).emit("Lighthouse-failed", {
                jobId,
                error: failedReason
            });
        });




    }catch(err){
        console.log("Error: Lighthouse error !!!", err)
    }

   
}
