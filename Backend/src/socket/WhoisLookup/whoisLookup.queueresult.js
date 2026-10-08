
import { whoisLookup, whoisLookupListener } from "../../queue/WhoisLookup.Queue.js";
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

      // Because jobId === dbId, fallback to DB document to retrieve userId/guestId/room if needed
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

      if (userRoom) {
        const payload = {
          jobId,
          whoisDbId: data?.whoisDbId || jobId,
          recordId: data?.recordId || jobId,
          roomId: userRoom,
          result: data?.result ?? data,
          status: data?.status || "completed",
          error: data?.error || null,
        };

        // Emit to room (supporting both naming conventions for compatibility)
        io.to(userRoom).emit("whoisLookupCompleted", payload);
        io.to(userRoom).emit("whoisLookup-completed", payload);

        console.log(`[whoisLookup] Result emitted to room: ${userRoom} for job: ${jobId}`);
      } else {
        console.warn(`[whoisLookup] Unable to find destination room for job ${jobId}`);
      }
    } catch (err) {
      console.error(`[whoisLookup] Error processing completed event for job ${jobId}:`, err);
    }
  });

  // Failed job event - uses MongoDB primary key (jobId === whoisDbId) without Redis roundtrip
  queueEvent.on("failed", async ({ jobId, failedReason }) => {
    console.error(`[whoisLookup] Job ${jobId} failed:`, failedReason);

    try {
      const whoisDoc = await WhoisLookup.findByIdAndUpdate(
        jobId,
        {
          status: "failed",
          error: failedReason || "WHOIS lookup failed",
          completedAt: new Date(),
        },
        { new: true }
      ).lean();

      const targetRoom =
        whoisDoc?.roomId ||
        (whoisDoc?.userId
          ? `user:${whoisDoc.userId}`
          : whoisDoc?.guestId
          ? `guest:${whoisDoc.guestId}`
          : null);

      if (targetRoom) {
        const failPayload = {
          jobId,
          roomId: targetRoom,
          result: {
            status: "failed",
            error: failedReason || "WHOIS lookup failed",
          },
          status: "failed",
        };

        io.to(targetRoom).emit("whoisLookupFailed", failPayload);
        io.to(targetRoom).emit("whoisLookup-failed", failPayload);
      }
    } catch (err) {
      console.error(`[whoisLookup] Error processing failed event for job ${jobId}:`, err);
    }
  });
};

export const whoisLookupEvent = handleWhoisQueueEvent;

