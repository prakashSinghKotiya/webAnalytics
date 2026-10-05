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

            io.to(userRoom).emit("uptimeCompleted", {
                jobId,
                roomId: userRoom,
                monitorId: data.monitorId,
                url: data.url,
                result: data.result,
                status: data.status || "completed",
            });
        } catch (err) {
            console.error(`[Uptime] Error handling completed event for job ${jobId}:`, err);
        }
    });

    // Failed event: update DB and emit failure without getJob
    event.on("failed", async ({ jobId, failedReason }) => {
        console.error(`[Uptime] Job ${jobId} failed:`, failedReason);
        const job =  await uptimeMonitorQueue.getJob(jobId);
         if (!job) {
            console.warn(`[Uptime] Job ${jobId} no longer exists`);
            return;
        }

        const { roomId } = job?.data 

        try {
            // jobId for scheduler jobs usually contains scheduler or pattern, or we inspect failedReason
            // If job failed in worker, worker already updated DB if monitorId was known.
            // If emitted to room, we emit an error event
            io.to(roomId).emit("uptimeMonitor-failed", {
                jobId,
                error: failedReason || "Uptime check failed",
                status: "failed",
            });
        } catch (err) {
            console.error(`[Uptime] Error processing failed event for job ${jobId}:`, err);
        }
    });
};



