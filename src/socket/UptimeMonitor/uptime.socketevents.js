
export const  sendUptimeResult = (io, socket )=> { 

    socket.on("uptime-job", ({monitorId}) => {
        
        const roomId = `uptime-monitor:${monitorId}`;
        console.log(`ttfb-job event received for roomId: ${monitorId} from socket: ${socket.id}` , roomId);
        
        socket.join(roomId)  // creating a room for the specific jobid so that we can send the result to the specific socket that requested it
    }   )

} 

