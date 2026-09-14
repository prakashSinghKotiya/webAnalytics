export const LighthouseConnection = (io, socket )=> { 

    socket.on("Lighthouse-job", ({roomId}) => {
        const room = roomId ;
          console.log(`Lighthouse-job event received for roomId: ${roomId} from socket: ${socket.id}` );
        console.log("room", room);
        socket.join(room)  // creating a room for the specific jobid so that we can send the result to the specific socket that requested it
    }  
 )}