import { indiaTtfbQueue, europeTtfbQueue, usaTtfbQueue } from "../../queue/ttfb.queue.js";
import { europeTtfbQueueEvent, indiaTtfbQueueEvent, usaTtfbQueueEvent } from "../../queue/ttfb.QeventListner.js";

// Handling bullmq queue events when jobs complete or fail
export const setupTtfbQueueResult = (io) => {
  handleQueueEvent(indiaTtfbQueueEvent, indiaTtfbQueue, "india", io);
  handleQueueEvent(europeTtfbQueueEvent, europeTtfbQueue, "europe", io);
  handleQueueEvent(usaTtfbQueueEvent, usaTtfbQueue, "usa", io);
};

export const handleQueueEvent = (queueEvent, queue, region, io) => {
  try {
    queueEvent.on("completed", async ({ jobId, returnvalue, returnValue }) => {
      console.log(`[TTFB ${region}] job ${jobId} completed`);

      let data = returnvalue || returnValue;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch (e) {
          console.error(`[TTFB ${region}] Failed to parse returnvalue JSON:`, e);
        }
      }

      // Ensure userRoom is resolved either from payload or from the BullMQ job in Redis
      let userRoom = data?.roomId;
      if (!userRoom && queue) {
        try {
          const job = await queue.getJob(jobId);
          userRoom = job?.data?.roomId;
        } catch (e) {
          console.error(`[TTFB ${region}] Failed to fetch job for roomId:`, e);
        }
      }

      console.log(`[TTFB ${region}] emitting ttfbCompleted to room:`, userRoom, "data:", data);

      if (userRoom) {
        io.to(userRoom).emit("ttfbCompleted", {
          jobId: jobId,
          roomId: userRoom,
          result: data,
          region: region,
        });
      } else {
        console.warn(`[TTFB ${region}] Warning: No userRoom found for job ${jobId}`);
      }
    });

    queueEvent.on("failed", async ({ jobId, failedReason }) => {
      console.log(`[TTFB ${region}] job ${jobId} failed:`, failedReason);

      let userRoom = null;
      if (queue) {
        try {
          const job = await queue.getJob(jobId);
          userRoom = job?.data?.roomId;
        } catch (e) {
          console.error(`[TTFB ${region}] Failed to get failed job:`, e);
        }
      }

      if (userRoom) {
        io.to(userRoom).emit("ttfbCompleted", {
          jobId: jobId,
          roomId: userRoom,
          region: region,
          result: {
            region,
            status: "failed",
            error: failedReason || "TTFB measurement failed",
          },
        });
      }
    });
  } catch (err) {
    console.error(`[TTFB ${region}] Error in handleQueueEvent:`, err);
  }
};