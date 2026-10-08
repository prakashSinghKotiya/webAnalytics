import { whoisLookup } from "../../queue/WhoisLookup.Queue.js";
import { whoisLookupListener } from "../../queue/whoisLookup.QeventListner.js";
import { WhoisLookup } from "../../Models/whoisLookup.Model.js";

// Handling BullMQ queue events when WHOIS lookup jobs complete or fail
export const whoisLookupResultHandler = (io) => {
  handleWhoisQueueEvent(whoisLookupListener, io);
};

export const setupWhoisLookupQueueResult = whoisLookupResultHandler;

export const handleWhoisQueueEvent = (queueEvent, io) => {
  // Connection / stream error handler to avoid unhandled EventEmitter exceptions
  queueEvent.on("error", (err) => {
    console.error("[whoisLookup] QueueEvents error:", err);
  });

  // Completed job event
  queueEvent.on("completed", async ({ jobId, returnvalue, returnValue }) => {
    try {
      let raw = returnvalue || returnValue;
      let data = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (!data) {
        console.warn(`[whoisLookup] No returnvalue data found for job ${jobId}`);
      }

      let userId = data?.userId;
      let guestId = data?.guestId;
      let userRoom =
        data?.roomId ||
        (userId ? `user:${userId}` : guestId ? `guest:${guestId}` : null);

      // Fallback to DB document if needed
      if (!userRoom && jobId) {
        const doc = await WhoisLookup.findById(jobId).lean();
        if (doc?.roomId) {
          userRoom = doc.roomId;
        } else if (doc?.userId) {
          userId = doc.userId.toString();
          userRoom = `user:${userId}`;
        } else if (doc?.guestId) {
          guestId = doc.guestId;
          userRoom = `guest:${guestId}`;
        }
      }

      // Final fallback to Redis job
      if (!userRoom) {
        try {
          const job = await whoisLookup.getJob(jobId);
          if (job?.data?.roomId) {
            userRoom = job.data.roomId;
          } else if (job?.data?.userId) {
            userRoom = `user:${job.data.userId}`;
          } else if (job?.data?.guestId) {
            userRoom = `guest:${job.data.guestId}`;
          }
        } catch (jobErr) {
          console.error(`[whoisLookup] Error retrieving job ${jobId} on complete:`, jobErr);
        }
      }

      if (!userRoom) {
        console.warn(`[whoisLookup] No room found for completed job ${jobId}`);
        return;
      }

      const payload = {
        jobId,
        whoisDbId: data?.whoisDbId || data?.recordId || jobId,
        recordId: data?.recordId || data?.whoisDbId || jobId,
        roomId: userRoom,
        result: data?.result,
        status: data?.status || "completed",
        error: data?.error || null,
      };

      io.to(userRoom).emit("whoisLookupCompleted", payload);
      io.to(userRoom).emit("whoisLookup-completed", payload);

      console.log(`[whoisLookup] Result emitted to room: ${userRoom} for job: ${jobId}`);
    } catch (err) {
      console.error(`[whoisLookup] Error handling completed event for job ${jobId}:`, err);
    }
  });

  // Failed job event
  queueEvent.on("failed", async ({ jobId, failedReason }) => {
    console.error(`[whoisLookup] Job ${jobId} failed:`, failedReason);

    try {
      const doc = await WhoisLookup.findByIdAndUpdate(
        jobId,
        {
          status: "failed",
          error: failedReason || "WHOIS lookup failed",
          completedAt: new Date(),
        },
        { new: true }
      ).lean();

      let userRoom =
        doc?.roomId ||
        (doc?.userId ? `user:${doc.userId}` : doc?.guestId ? `guest:${doc.guestId}` : null);

      if (!userRoom) {
        try {
          const job = await whoisLookup.getJob(jobId);
          if (job?.data?.roomId) {
            userRoom = job.data.roomId;
          } else if (job?.data?.userId) {
            userRoom = `user:${job.data.userId}`;
          } else if (job?.data?.guestId) {
            userRoom = `guest:${job.data.guestId}`;
          }
        } catch (jobErr) {
          console.error(`[whoisLookup] Error retrieving job ${jobId} on fail:`, jobErr);
        }
      }

      if (!userRoom) {
        console.warn(`[whoisLookup] No room found for failed job ${jobId}`);
        return;
      }

      const payload = {
        jobId,
        whoisDbId: jobId,
        recordId: jobId,
        roomId: userRoom,
        status: "failed",
        error: failedReason || "WHOIS lookup failed",
      };

      io.to(userRoom).emit("whoisLookupFailed", payload);
      io.to(userRoom).emit("whoisLookup-failed", payload);

      console.log(`[whoisLookup] Failure emitted to room: ${userRoom} for job: ${jobId}`);
    } catch (err) {
      console.error(`[whoisLookup] Error handling failed event for job ${jobId}:`, err);
    }
  });
};

export default whoisLookupResultHandler;
