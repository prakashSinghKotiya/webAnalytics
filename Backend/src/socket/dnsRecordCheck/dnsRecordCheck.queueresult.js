
import { dnsRecordCheck, dnsRecordCheckListener } from "../../queue/dnsRecordCheck.Queue.js";



export const dnsRecordCheckResultHandler =(io) => {

    dnsRecordCheckEvent(dnsRecordCheckListener ,io)

}


export const dnsRecordCheckEvent = (event , io) =>{

    try{
         event.on("completed", ({jobId , returnValue}) => {
        console.log(`dnsRecordCheck job ${jobId} completed`);
        const userRoom =  returnValue?.roomId
      //  const userRoom = `user:${room}`;
        

        io.to(userRoom).emit("dnsRecordCheck-completed", { jobId: jobId, result: returnValue } )
        
        console.log(`result sent to room: ${room}`)
    

        })



         event.on("failed", async({ jobId, failedReason }) => {

            console.log(`dnsRecordCheck job ${jobId} failed`);

            const job = await dnsRecordCheck.getJob(jobId)
             const userRoom = job?.data?.roomId;
          //   const userRoom = `user:${roomId}`

            console.log("Reason:", failedReason);

            io.to(userRoom).emit("dnsRecordCheck-failed", {
                jobId,
                error: failedReason
            });
        });




    }catch(err){
        console.log("Error: dnsRecordCheck error !!!", err)
    }

   
}
