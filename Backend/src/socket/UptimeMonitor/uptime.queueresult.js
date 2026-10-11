import { indiaUptimeRobotEvent } from "../../queue/uptime.QeventListner.js";
import { UptimeMonitor } from "../../Models/UptimeMonitor.Model.js";
import { uptimeMonitorQueue } from "../../queue/uptime.queue.js";

export const UptimeRobotEventHandler = (io) => {
    UptimeRobotEventResult(indiaUptimeRobotEvent, io);
};

export const UptimeRobotEventResult = (event, io) => {
    // Avoid unhandled stream error crashes
    event.on("error", (err) => {
        console.error("[Uptime QueueEvents] Stream error:", err);
    });

    // Completed event: extract returnvalue directly without getJob Redis round-trips
    event.on("completed", async ({ jobId, returnvalue, returnValue }) => {
        try {
            let raw = returnvalue || returnValue;
            let data = typeof raw === "string" ? JSON.parse(raw) : raw;

            if (!data) {
                console.warn(`[Uptime] No returnvalue found for completed job ${jobId}`);
                return;
            }

            const userRoom = data.roomId || (data.userId ? `user:${data.userId}` : null);
            if (!userRoom) {
                console.warn(`[Uptime] No roomId/userId for job ${jobId}`);
                return;
            }

            const payload = {
                jobId,
                roomId: userRoom,
                monitorId: data.monitorId,
                url: data.url,
                result: data.result,
                status: data.status || "completed",
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

    // Failed event: update DB and emit failure
    event.on("failed", async ({ jobId, failedReason }) => {
        console.error(`[Uptime] Job ${jobId} failed:`, failedReason);
        let roomId = null;
        try {
            const job = await uptimeMonitorQueue.getJob(jobId);
            roomId = job?.data?.roomId;
        } catch (jobErr) {
            console.error(`[Uptime] Error getting job ${jobId} on failure:`, jobErr.message);
        }

        if (roomId) {
            try {
                const failPayload = {
                    jobId,
                    roomId,
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
};

export default UptimeRobotEventHandler;
