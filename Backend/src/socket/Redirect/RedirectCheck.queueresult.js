
import { redirectQueue, redirectQueueListener } from "../../queue/redirectCheck.Queue.js";
import { RedirectCheck } from "../../Models/redirectCheck.Model.js";

// Handling BullMQ queue events when Redirect Check jobs complete or fail
export const redirectQueueResultHandler = (io) => {
  handleRedirectQueueEvent(redirectQueueListener, io);
};

export const setupRedirectQueueResult = redirectQueueResultHandler;

export const handleRedirectQueueEvent = (queueEvent, io) => {
  // Connection / stream error handler to avoid unhandled EventEmitter exceptions
  queueEvent.on("error", (err) => {
    console.error("[redirectCheck] QueueEvents error:", err);
  });

  // Completed job event
  queueEvent.on("completed", async ({ jobId, returnvalue, returnValue }) => {
    try {
      let raw = returnvalue || returnValue;
      let data = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (!data) {
        console.warn(`[redirectCheck] No returnvalue data found for job ${jobId}`);
      }

      let userId = data?.userId;
      let userRoom = data?.roomId;

      // Because jobId === dbId, fallback to DB document to retrieve userId/room if needed
      if (!userRoom && jobId) {
        const doc = await RedirectCheck.findById(jobId).lean();
        if (doc?.userId) {
          userId = doc.userId.toString();
          userRoom = `user:${userId}`;
        }
      }

      if (!userRoom && userId) {
        userRoom = `user:${userId}`;
      }

      // Final fallback to Redis job
      if (!userRoom) {
        try {
          const job = await redirectQueue.getJob(jobId);
          if (job?.data?.userId) {
            userRoom = `user:${job.data.userId}`;
          } else if (job?.data?.roomId) {
            userRoom = job.data.roomId;
          }
        } catch (jobErr) {
          console.error(`[redirectCheck] Error retrieving job ${jobId} on complete:`, jobErr);
        }
      }

      if (userRoom) {
        const payload = {
          jobId,
          redirectCheckId: data?.redirectCheckId || jobId,
          recordId: data?.recordId || jobId,
          roomId: userRoom,
          result: data?.result ?? data,
          status: data?.status || "completed",
          error: data?.error || null,
        };

        // Emit to user room (supporting both naming conventions for compatibility)
        io.to(userRoom).emit("redirectCheckCompleted", payload);
        io.to(userRoom).emit("redirectQueue-completed", payload);

        console.log(`[redirectCheck] Result emitted to room: ${userRoom} for job: ${jobId}`);
      } else {
        console.warn(`[redirectCheck] Unable to find destination room for job ${jobId}`);
      }
    } catch (err) {
      console.error(`[redirectCheck] Error processing completed event for job ${jobId}:`, err);
    }
  });

  // Failed job event - uses MongoDB primary key (jobId === redirectCheckId) without Redis roundtrip
  queueEvent.on("failed", async ({ jobId, failedReason }) => {
    console.error(`[redirectCheck] Job ${jobId} failed:`, failedReason);

    try {
      let redirectDoc = null;

      // Update DB record if valid ObjectId
      if (jobId) {
        redirectDoc = await RedirectCheck.findByIdAndUpdate(
          jobId,
          {
            status: "failed",
            error: failedReason || "Redirect check failed",
            completedAt: new Date(),
          },
          { new: true }
        ).lean();
      }

      let userId = redirectDoc?.userId?.toString();
      let userRoom = userId ? `user:${userId}` : null;

      // Fallback: If DB doc wasn't found or userId missing, check Redis job data
      if (!userRoom) {
        try {
          const job = await redirectQueue.getJob(jobId);
          if (job?.data?.userId) {
            userRoom = `user:${job.data.userId}`;
          } else if (job?.data?.roomId) {
            userRoom = job.data.roomId;
          }
        } catch (jobErr) {
          console.error(`[redirectCheck] Error fetching job ${jobId} from queue on failure:`, jobErr);
        }
      }

      if (userRoom) {
        const failPayload = {
          jobId,
          redirectCheckId: jobId,
          recordId: jobId,
          roomId: userRoom,
          result: {
            status: "failed",
            error: failedReason || "Redirect check failed",
          },
          error: failedReason || "Redirect check failed",
          status: "failed",
        };

        io.to(userRoom).emit("redirectCheckFailed", failPayload);
        io.to(userRoom).emit("redirectQueue-failed", failPayload);

        console.log(`[redirectCheck] Failure event emitted to room: ${userRoom} for job: ${jobId}`);
      } else {
        console.warn(`[redirectCheck] Unable to resolve room for failed job ${jobId}`);
      }
    } catch (err) {
      console.error(`[redirectCheck] Error processing failed event for job ${jobId}:`, err);
    }
  });
};

export const redirectQueueEvent = handleRedirectQueueEvent;

