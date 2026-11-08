import { indiaUptimeRobotEvent } from "../../queue/uptime.QeventListner.js";
import { prisma } from "../../config/db.prismaSQL.js";

export const UptimeRobotEventHandler = (io) => {
  UptimeRobotEventResult(indiaUptimeRobotEvent, io);
};

export const UptimeRobotEventResult = (event, io) => {
  // Avoid unhandled stream error crashes
  event.on("error", (err) => {
    console.error("[Uptime QueueEvents] Stream error:", err);
  });

  // Completed event: result comes straight from the worker's return value
  event.on("completed", async ({ jobId, returnvalue, returnValue }) => {
    try {
      const raw = returnvalue || returnValue;
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (!data) {
        // Paused or non-existent monitors safely return null from worker
        return;
      }

      let userRoom = data.roomId || (data.userId ? `user:${data.userId}` : null);

      const monId = parseInt(data.monitorId, 10);
      let hostinginfo = data.hostinginfo || null;

      if (!userRoom && !Number.isNaN(monId)) {
        const doc = await prisma.uptimeMonitor.findUnique({
          where: { id: monId },
          select: { userId: true, hostinginfo: true },
        }).catch(() => null);

        if (doc?.userId) {
          userRoom = `user:${doc.userId}`;
        }
        if (!hostinginfo && doc?.hostinginfo) {
          hostinginfo = doc.hostinginfo;
        }
      }

      if (!userRoom) {
        console.warn(`[Uptime] No roomId/userId found for completed job ${jobId}`);
        return;
      }

      // Enforce zero runner information leakage to client sockets
      let sanitizedResult = data.result;
      if (sanitizedResult && typeof sanitizedResult === "object") {
        const { runnerName, runner, runnerId, ...clean } = sanitizedResult;
        sanitizedResult = clean;
      }

      const payload = {
        jobId,
        roomId: userRoom,
        monitorId: data.monitorId,
        url: data.url,
        result: sanitizedResult,
        status: data.status || "completed",
        hostinginfo,
      };

      const sockets = await io.in(userRoom).fetchSockets();
      if (!sockets || sockets.length === 0) {
        console.warn(`[Uptime] Room ${userRoom} has 0 connected sockets. Result is persisted in DB for job ${jobId}.`);
      } else {
        console.log(`[Uptime] Result emitted to ${sockets.length} socket(s) in room: ${userRoom} for job: ${jobId}`);
      }

      io.to(userRoom).emit("uptime:result", payload);
      io.to(userRoom).emit("uptimeCompleted", payload);
    } catch (err) {
      console.error(`[Uptime] Error handling completed event for job ${jobId}:`, err);
    }
  });

  // Failed event: emit failure payload to room
  event.on("failed", async ({ jobId, failedReason, data }) => {
    console.error(`[Uptime] Job ${jobId} failed:`, failedReason);

    let roomId = data?.roomId;
    if (!roomId && data?.userId) {
      roomId = `user:${data.userId}`;
    }

    if (!roomId && data?.monitorId) {
      const monId = parseInt(data.monitorId, 10);
      if (!Number.isNaN(monId)) {
        const doc = await prisma.uptimeMonitor.findUnique({
          where: { id: monId },
          select: { userId: true },
        }).catch(() => null);

        if (doc?.userId) {
          roomId = `user:${doc.userId}`;
        }
      }
    }

    if (roomId) {
      try {
        const failPayload = {
          jobId,
          roomId,
          monitorId: data?.monitorId,
          error: failedReason || "Uptime check failed",
          status: "failed",
        };

        const sockets = await io.in(roomId).fetchSockets();
        if (!sockets || sockets.length === 0) {
          console.warn(`[Uptime] Room ${roomId} has 0 connected sockets on fail for job ${jobId}.`);
        }

        io.to(roomId).emit("uptime:result", failPayload);
        io.to(roomId).emit("uptimeMonitor-failed", failPayload);
      } catch (err) {
        console.error(`[Uptime] Error processing failed event for job ${jobId}:`, err);
      }
    }
  });

  // Start consuming only after the listeners above are attached
  event.start().catch((err) => {
    console.error("[Uptime] Failed to start completion listener:", err);
  });
};

export default UptimeRobotEventHandler;
