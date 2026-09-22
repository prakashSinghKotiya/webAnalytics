import http from "http";
import { app } from "./server.js";
import { Server } from "socket.io";



import { setupTtfbQueueResult } from "./socket/ttfb/ttfb.queueresult.js";

import { UptimeRobotEventHandler } from "./socket/UptimeMonitor/uptime.queueresult.js";

import { LighthouseResultHandler } from "./socket/Lighthouse/Lighthouse.queueresult.js";

import "./Workers/ttfbStart.worker.js"
import { socketAuthMiddleware } from "./Middleware/Socket.middleware.js";

const server = http.createServer(app);

export const io = new Server( server, {
    cors: {
        origin: process.env.SOCKET_ORIGIN || "http://localhost:5173" ,
        methods: ["GET", "POST"],
        credentials: true
       
    },
      allowsEIO3: true,
});
  
io.use(socketAuthMiddleware)


io.on("connection", (socket) => {
    console.log("socket Authenticated User ID:", socket.data.userId);

    const userId = socket.data.userId;

    const userRoom = `user:${userId}`;

     socket.join(userRoom);


    
    // sendTtfbResult(io, socket);

    // sendUptimeResult(io, socket)

    // LighthouseConnection(io , socket)
    

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
})

setupTtfbQueueResult(io);  // setting up the queue event listener for ttfb queue result
UptimeRobotEventHandler(io)
LighthouseResultHandler(io)


const PORT = process.env.PORT || 5000

server.listen(PORT, () => {
    console.log(" server is running");
})
