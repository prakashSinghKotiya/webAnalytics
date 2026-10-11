import http from "http";
import { app } from "./server.js";
import { Server } from "socket.io";



import { setupTtfbQueueResult } from "./socket/ttfb/ttfb.queueresult.js";
import { UptimeRobotEventHandler } from "./socket/UptimeMonitor/uptime.queueresult.js";
import { LighthouseResultHandler } from "./socket/Lighthouse/Lighthouse.queueresult.js";
import { dnsRecordCheckResultHandler } from "./socket/dnsRecordCheck/dnsRecordCheck.queueresult.js";
import { redirectQueueResultHandler } from "./socket/Redirect/RedirectCheck.queueresult.js";
import { whoisLookupResultHandler } from "./socket/WhoisLookup/whoisLookup.queueresult.js";
import { socketAuthMiddleware } from "./Middleware/Socket.middleware.js";

const server = http.createServer(app);

const socketOriginConfig = process.env.SOCKET_ORIGIN || process.env.CLIENT_ORIGIN || "http://localhost:5173";
const allowedSocketOrigins = socketOriginConfig.split(',').map((o) => o.trim().replace(/\/+$/, ''));

export const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const normalized = origin.replace(/\/+$/, '');
      if (allowedSocketOrigins.includes('*') || allowedSocketOrigins.includes(normalized) || origin === process.env.SOCKET_ORIGIN || origin === process.env.CLIENT_ORIGIN) {
        return callback(null, origin);
      }
      return callback(null, origin);
    },
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "x-guest-id", "x-session-id"],
  },
  allowsEIO3: true,
  transports: ["websocket", "polling"],
});

// Provide io instance to Express routes via req.app.get("io")
app.set("io", io);

io.use(socketAuthMiddleware);

import { handleSocketCatchup } from "./socket/catchup.Service.js";

io.on("connection", (socket) => {
  const roomIds = socket.data.roomIds || [];
  console.log(`[Socket] Connected socket ${socket.id} to rooms:`, roomIds);

  socket.join(roomIds);

  socket.on("catchup", async (data) => {
    await handleSocketCatchup(socket, data);
  });

  socket.on("disconnect", (reason) => {
    console.log(`[Socket] Disconnected socket ${socket.id} (${reason})`);
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
