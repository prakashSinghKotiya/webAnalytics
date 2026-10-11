import { Lighthouequeue } from "../../queue/Lighthouse.queue.js";
import { LighthouequeueListner } from "../../queue/Lighthouse.QueueListner.js";
import { Lighthouse } from "../../Models/Lighthouse.Model.js";

// Handling BullMQ queue events when Lighthouse jobs complete or fail
export const LighthouseResultHandler = (io) => {
  handleQueueEvent(LighthouequeueListner, io);
};

export const setupLighthouseQueueResult = LighthouseResultHandler;

export const handleQueueEvent = (queueEvent, io) => {
  // Connection / stream error handler to avoid unhandled EventEmitter exceptions
  queueEvent.on("error", (err) => {
    console.error("[Lighthouse] QueueEvents error:", err);
  });

  // Completed job event 
  queueEvent.on("completed", async ({ jobId, returnvalue, returnValue }) => {
    try {
      let raw = returnvalue || returnValue;
      let data = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (!data) {
        console.warn(`[Lighthouse] No returnvalue data found for job ${jobId}`);
        return;
      }

      const roomId = data.roomId;
      if (!roomId) {
        console.warn(`[Lighthouse] No roomId present in job ${jobId} returnvalue`);
        return;
      }

      const payload = {
        jobId,
        lighthousedbId: data.lighthousedbId || jobId,
        roomId,
        result: data.result,
        status: data.status || "completed",
      };

      const sockets = await io.in(roomId).fetchSockets();
      if (!sockets || sockets.length === 0) {
        console.warn(`[Lighthouse] Room ${roomId} has 0 connected sockets. Result is persisted in DB for job ${jobId}.`);
      } else {
        console.log(`[Lighthouse] Result emitted to ${sockets.length} socket(s) in room: ${roomId} for job: ${jobId}`);
      }

      // Emit standard and legacy events
      io.to(roomId).emit("lighthouse:result", payload);
      io.to(roomId).emit("lighthouseCompleted", payload);
      io.to(roomId).emit("Lighthouse-completed", payload);
    } catch (err) {
      console.error(`[Lighthouse] Error processing completed event for job ${jobId}:`, err);
    }
  });

  // Failed job event 
  queueEvent.on("failed", async ({ jobId, failedReason }) => {
    console.error(`[Lighthouse] Job ${jobId} failed:`, failedReason);

    try {
      let lighthouseDoc = null;

      // Update DB record if valid ObjectId
      if (jobId) {
        lighthouseDoc = await Lighthouse.findByIdAndUpdate(
          jobId,
          {
            status: "failed",
            error: failedReason || "Lighthouse analysis failed",
            completedAt: new Date(),
          },
          { new: true }
        ).lean();
      }

      let userRoom = lighthouseDoc?.roomId || null;

      // Fallback: If DB doc wasn't found or userId missing, check Redis job data
      if (!userRoom) {
        try {
          const job = await Lighthouequeue.getJob(jobId);
          if (job?.data?.roomId) {
            userRoom = job.data.roomId;
          }
        } catch (jobErr) {
          console.error(`[Lighthouse] Error fetching job ${jobId} from queue on failure:`, jobErr);
        }
      }

      if (userRoom) {
        const failPayload = {
          jobId,
          lighthousedbId: jobId,
          roomId: userRoom,
          result: {
            status: "failed",
            error: failedReason || "Lighthouse analysis failed",
          },
          error: failedReason || "Lighthouse analysis failed",
          status: "failed",
        };

        const sockets = await io.in(userRoom).fetchSockets();
        if (!sockets || sockets.length === 0) {
          console.warn(`[Lighthouse] Room ${userRoom} has 0 connected sockets on fail for job ${jobId}.`);
        }

        io.to(userRoom).emit("lighthouse:result", failPayload);
        io.to(userRoom).emit("lighthouseCompleted", failPayload);
        io.to(userRoom).emit("Lighthouse-failed", failPayload);

        console.log(`[Lighthouse] Failure event emitted to room: ${userRoom} for job: ${jobId}`);
      }
    } catch (err) {
      console.error(`[Lighthouse] Error processing failed event for job ${jobId}:`, err);
    }
  });
};

export const lighthouseevent = handleQueueEvent;
