
import { whoisLookup } from "../../queue/WhoisLookup.Queue.js"
import { whoisLookupListener } from "../../queue/WhoisLookup.Queue.js";


export const whoisLookupResultHandler =(io) => {

    whoisLookupEvent(whoisLookupListener ,io)

}


export const whoisLookupEvent = (event , io) =>{

    try{
         event.on("completed", ({jobId , returnValue}) => {
        console.log(`whoisLookup job ${jobId} completed`);
        const room =  returnValue?.roomId
        const userRoom = `user:${room}`;
        

        io.to(userRoom).emit("whoisLookup-completed", { jobId: jobId, result: returnValue } )
        
        console.log(`result sent to room: ${room}`)
    

        })



         event.on("failed", async({ jobId, failedReason }) => {

            console.log(`whoisLookup job ${jobId} failed`);

            const job = await whoisLookup.getJob(jobId)
             const roomId = job?.data?.roomId;
             const userRoom = `user:${roomId}`

            console.log("Reason:", failedReason);

            io.to(userRoom).emit("whoisLookup-failed", {
                jobId,
                error: failedReason
            });
        });




    }catch(err){
        console.log("Error: whoisLookup error !!!", err)
    }

   
}
