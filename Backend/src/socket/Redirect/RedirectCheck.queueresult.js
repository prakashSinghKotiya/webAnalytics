import { redirectQueue } from "../../queue/redirectCheck.Queue.js";
import { redirectQueueListener } from "../../queue/redirectCheck.QeventListner.js";
import { RedirectCheck } from "../../Models/redirectCheck.Model.js";

// Handling BullMQ queue events when Redirect Check jobs complete or fail
export const redirectQueueResultHandler = (io) => {
  handleRedirectQueueEvent(redirectQueueListener, io);
};

export const setupRedirectQueueResult = redirectQueueResultHandler;

export const handleRedirectQueueEvent = (queueEvent, io) => {
  // Connection error handling
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

      let userRoom =
        data?.roomId ||
        (data?.userId
          ? `user:${data.userId}`
          : data?.guestId
          ? `guest:${data.guestId}`
          : null);

      // Fallback to DB document if room not in payload
      if (!userRoom && jobId) {
        const doc = await RedirectCheck.findById(jobId).lean();
        userRoom =
          doc?.roomId ||
          (doc?.userId
            ? `user:${doc.userId}`
            : doc?.guestId
            ? `guest:${doc.guestId}`
            : null);
      }

      // Final fallback to Redis job
      if (!userRoom) {
        try {
          const job = await redirectQueue.getJob(jobId);
          if (job?.data?.roomId) {
            userRoom = job.data.roomId;
          } else if (job?.data?.userId) {
            userRoom = `user:${job.data.userId}`;
          } else if (job?.data?.guestId) {
            userRoom = `guest:${job.data.guestId}`;
          }
        } catch (jobErr) {
          console.error(`[redirectCheck] Error retrieving job ${jobId} on complete:`, jobErr);
        }
      }

      if (!userRoom) {
        console.warn(`[redirectCheck] No room found for completed job ${jobId}`);
        return;
      }

      const payload = {
        jobId,
        redirectCheckId: data?.redirectCheckId || data?.recordId || jobId,
        recordId: data?.recordId || data?.redirectCheckId || jobId,
        roomId: userRoom,
        result: data?.result,
        status: data?.status || "completed",
        error: data?.error || null,
      };

      io.to(userRoom).emit("redirectCheckCompleted", payload);
      io.to(userRoom).emit("redirect-completed", payload);

      console.log(`[redirectCheck] Result emitted to room: ${userRoom} for job: ${jobId}`);
    } catch (err) {
      console.error(`[redirectCheck] Error handling completed event for job ${jobId}:`, err);
    }
  });

  // Failed job event
  queueEvent.on("failed", async ({ jobId, failedReason }) => {
    console.error(`[redirectCheck] Job ${jobId} failed:`, failedReason);

    try {
      const doc = await RedirectCheck.findByIdAndUpdate(
        jobId,
        {
          status: "failed",
          error: failedReason || "Redirect check failed",
          completedAt: new Date(),
        },
        { new: true }
      ).lean();

      let userRoom =
        doc?.roomId ||
        (doc?.userId ? `user:${doc.userId}` : doc?.guestId ? `guest:${doc.guestId}` : null);

      if (!userRoom) {
        try {
          const job = await redirectQueue.getJob(jobId);
          if (job?.data?.roomId) {
            userRoom = job.data.roomId;
          } else if (job?.data?.userId) {
            userRoom = `user:${job.data.userId}`;
          } else if (job?.data?.guestId) {
            userRoom = `guest:${job.data.guestId}`;
          }
        } catch (jobErr) {
          console.error(`[redirectCheck] Error retrieving job ${jobId} on fail:`, jobErr);
        }
      }

      if (!userRoom) {
        console.warn(`[redirectCheck] No room found for failed job ${jobId}`);
        return;
      }

      const payload = {
        jobId,
        redirectCheckId: jobId,
        recordId: jobId,
        roomId: userRoom,
        status: "failed",
        error: failedReason || "Redirect check failed",
      };

      io.to(userRoom).emit("redirectCheckFailed", payload);
      io.to(userRoom).emit("redirect-failed", payload);

      console.log(`[redirectCheck] Failure emitted to room: ${userRoom} for job: ${jobId}`);
    } catch (err) {
      console.error(`[redirectCheck] Error handling failed event for job ${jobId}:`, err);
    }
  });
};

export default redirectQueueResultHandler;
