
export const  sendTtfbResult = (io, socket )=> { 

    socket.on("ttfb-job", ({roomId}) => {
      
        const room = roomId ;
          console.log(`ttfb-job event received for roomId: ${roomId} from socket: ${socket.id}` , roomId);
        console.log("room", room);
        socket.join(room)  // creating a room for the specific jobid so that we can send the result to the specific socket that requested it
    }   )


    socket.on("ttfb-job-global", ({roomId}) => {
        console.log(`ttfb-job event received for roomId: ${roomId} from socket: ${socket.id}` , roomId);
        const room = roomId ;
        console.log("room", room);
        socket.join(room)  // creating a room for the specific jobid so that we can send the result to the specific socket that requested it
    }   )
} 

