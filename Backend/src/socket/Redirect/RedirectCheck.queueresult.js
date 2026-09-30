
import { redirectQueue, redirectQueueListener } from "../../queue/redirectCheck.Queue.js";



export const redirectQueueResultHandler =(io) => {

    redirectQueueEvent(redirectQueueListener ,io)

}


export const redirectQueueEvent = (event , io) =>{

    try{
         event.on("completed", ({jobId , returnValue}) => {
        console.log(`redirectQueueListener job ${jobId} completed`);
        const room =  returnValue?.roomId
        const userRoom = `user:${room}`;
        

        io.to(userRoom).emit("redirectQueue-completed", { jobId: jobId, result: returnValue } )
        
        console.log(`result sent to room: ${room}`)
    

        })



         event.on("failed", async({ jobId, failedReason }) => {

            console.log(`redirectQueue job ${jobId} failed`);

            const job = await redirectQueue.getJob(jobId)
             const roomId = job?.data?.roomId;
             const userRoom = `user:${roomId}`

            console.log("Reason:", failedReason);

            io.to(userRoom).emit("redirectQueue-failed", {
                jobId,
                error: failedReason
            });
        });




    }catch(err){
        console.log("Error: redirectQueue error !!!", err)
    }

   
}
