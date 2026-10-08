import http from "http";
import { app } from "./server.js";
import { Server } from "socket.io";

//import "./Workers/worker.js"

import { setupTtfbQueueResult } from "./socket/ttfb/ttfb.queueresult.js";
import { UptimeRobotEventHandler } from "./socket/UptimeMonitor/uptime.queueresult.js";
import { LighthouseResultHandler } from "./socket/Lighthouse/Lighthouse.queueresult.js";
import { dnsRecordCheckResultHandler } from "./socket/dnsRecordCheck/dnsRecordCheck.queueresult.js";
import { redirectQueueResultHandler } from "./socket/Redirect/RedirectCheck.queueresult.js";
import { whoisLookupResultHandler } from "./socket/WhoisLookup/whoisLookup.queueresult.js";
import { socketAuthMiddleware } from "./Middleware/Socket.middleware.js";

const server = http.createServer(app);

export const io = new Server(server, {
  cors: {
    origin: process.env.SOCKET_ORIGIN || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
  allowsEIO3: true,
});

// Provide io instance to Express routes via req.app.get("io")
app.set("io", io);

io.use(socketAuthMiddleware);

io.on("connection", (socket) => {
  const roomIds = socket.data.roomIds || [];
  console.log("socket connected to rooms:", roomIds);

  socket.join(roomIds);

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

// Register queue result event handlers
setupTtfbQueueResult(io);
UptimeRobotEventHandler(io);
LighthouseResultHandler(io);
dnsRecordCheckResultHandler(io);
redirectQueueResultHandler(io);
whoisLookupResultHandler(io);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
