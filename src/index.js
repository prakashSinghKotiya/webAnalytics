import http from "http";
import { app } from "./server.js";
import { Server } from "socket.io";


import { sendTtfbResult } from "./socket/ttfb/ttfb.socketevent.js";
import { setupTtfbQueueResult } from "./socket/ttfb/ttfb.queueresult.js";
import { sendUptimeResult } from "./socket/UptimeMonitor/uptime.socketevents.js";
import { UptimeRobotEventHandler } from "./socket/UptimeMonitor/uptime.queueresult.js";
import { LighthouseConnection } from "./socket/Lighthouse/Lighthouse.socketevent.js";

const server = http.createServer(app);

export const io = new Server( server, {
    cors: {
        origin: process.env.SOCKET_ORIGIN || "*" ,
        methods: ["GET", "POST"],
        Credential:true ,
    },
      allowsEIO3: true,
});
  // setting up the queue event listener for ttfb queue result

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    
    sendTtfbResult(io, socket);

    sendUptimeResult(io, socket)

    LighthouseConnection(io , socket)
    

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
})

setupTtfbQueueResult(io);
UptimeRobotEventHandler(io)


const PORT = process.env.PORT || 5000

server.listen(PORT, () => {
    console.log(" server is running");
})
