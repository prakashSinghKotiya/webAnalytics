import { europeTtfbQueueEvent, indiaTtfbQueueEvent, usaTtfbQueueEvent } from "../../queue/ttfb.QeventListner.js";
import { Ttfb } from "../../Models/Ttfb.Model.js";

// Handling BullMQ queue events when jobs complete or fail
export const setupTtfbQueueResult = (io) => {
  handleQueueEvent(indiaTtfbQueueEvent, "india", io);
  handleQueueEvent(europeTtfbQueueEvent, "europe", io);
  handleQueueEvent(usaTtfbQueueEvent, "usa", io);
};

export const handleQueueEvent = (queueEvent, region, io) => {
  // Connection / stream error handler to avoid unhandled EventEmitter exceptions
  queueEvent.on("error", (err) => {
    console.error(`[TTFB ${region}] QueueEvents error:`, err);
  });

  // Completed job event - extract directly from worker returnvalue (no Redis getJob call needed)
  queueEvent.on("completed", async ({ jobId, returnvalue, returnValue }) => {
    try {
      let raw = returnvalue || returnValue;
      let data = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (!data) {
        console.warn(`[TTFB ${region}] No returnvalue data found for job ${jobId}`);
        return;
      }

      const userId = data.userId;
      if (!userId) {
        console.warn(`[TTFB ${region}] No userId present in job ${jobId} returnvalue`);
        return;
      }

      const userRoom = `user:${userId}`;

      io.to(userRoom).emit("ttfbCompleted", {
        jobId,
        roomId: userRoom,
        region: data.region || region,
        result: data.result,
        status: data.status || "completed",
      });
    } catch (err) {
      console.error(`[TTFB ${region}] Error processing completed event for job ${jobId}:`, err);
    }
  });

  // Failed job event - uses MongoDB primary key (jobId === ttfbdbId) without Redis getJob
  queueEvent.on("failed", async ({ jobId, failedReason }) => {
    console.error(`[TTFB ${region}] Job ${jobId} failed:`, failedReason);

    try {
      const ttfbDoc = await Ttfb.findByIdAndUpdate(
        jobId,
        {
          status: "failed",
          error: failedReason || "TTFB measurement failed",
          completedAt: new Date(),
        },
        { new: true }
      ).lean();

      if (ttfbDoc?.userId) {
        const userRoom = `user:${ttfbDoc.userId}`;
        io.to(userRoom).emit("ttfbCompleted", {
          jobId,
          roomId: userRoom,
          region: ttfbDoc.region || region,
          result: {
            region: ttfbDoc.region || region,
            status: "failed",
            error: failedReason || "TTFB measurement failed",
          },
          status: "failed",
        });
      }
    } catch (err) {
      console.error(`[TTFB ${region}] Error processing failed event for job ${jobId}:`, err);
    }
  });
};