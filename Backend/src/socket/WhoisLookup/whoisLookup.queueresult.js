import { whoisLookupListener } from "../../queue/whoisLookup.QeventListner.js";
import { prisma } from "../../config/db.prismaSQL.js";

// Handling pg-boss queue events when WHOIS lookup jobs complete or fail
export const whoisLookupResultHandler = (io) => {
  handleWhoisQueueEvent(whoisLookupListener, io);
};

export const setupWhoisLookupQueueResult = whoisLookupResultHandler;

export const handleWhoisQueueEvent = (queueEvent, io) => {
  // Connection / stream error handler to avoid unhandled EventEmitter exceptions
  queueEvent.on("error", (err) => {
    console.error("[whoisLookup] QueueEvents error:", err);
  });

  // Completed job event - result comes straight from the worker's return value
  queueEvent.on("completed", async ({ jobId, returnvalue, returnValue }) => {
    try {
      const raw = returnvalue || returnValue;
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (!data) {
        console.warn(`[whoisLookup] No returnvalue data found for job ${jobId}`);
        return;
      }

      let userRoom =
        data.roomId ||
        (data.userId ? `user:${data.userId}` : data.guestId ? `guest:${data.guestId}` : null);

      // Fallback to DB record if userRoom is missing
      if (!userRoom && (data.whoisDbId || data.recordId)) {
        const rawId = (data.whoisDbId || data.recordId).toString();
        const match = rawId.match(/\d+$/);
        const id = match ? parseInt(match[0], 10) : null;
        if (id && !Number.isNaN(id)) {
          const doc = await prisma.whoisLookup.findFirst({ where: { id } }).catch(() => null);
          if (doc?.roomId) {
            userRoom = doc.roomId;
          } else if (doc?.userId) {
            userRoom = `user:${doc.userId}`;
          } else if (doc?.guestId) {
            userRoom = `guest:${doc.guestId}`;
          }
        }
      }

      if (!userRoom) {
        console.warn(`[whoisLookup] No room found for completed job ${jobId}`);
        return;
      }

      const whoisDbId = (data.whoisDbId || data.recordId || jobId).toString();
      const payload = {
        jobId,
        whoisDbId,
        recordId: whoisDbId,
        roomId: userRoom,
        result: data.result,
        status: data.status || "completed",
        error: data.error || null,
      };

      const sockets = await io.in(userRoom).fetchSockets();
      if (!sockets || sockets.length === 0) {
        console.warn(`[whoisLookup] Room ${userRoom} has 0 connected sockets. Result is persisted in DB for job ${jobId}.`);
      } else {
        console.log(`[whoisLookup] Result emitted to ${sockets.length} socket(s) in room: ${userRoom} for job: ${jobId}`);
      }

      // Emit standard and legacy events
      io.to(userRoom).emit("whois:result", payload);
      io.to(userRoom).emit("whoisLookupCompleted", payload);
      io.to(userRoom).emit("whoisLookup-completed", payload);
    } catch (err) {
      console.error(`[whoisLookup] Error handling completed event for job ${jobId}:`, err);
    }
  });

  // Failed job event - fires once after retries are used up (or job expired)
  queueEvent.on("failed", async ({ jobId, failedReason, data }) => {
    console.error(`[whoisLookup] Job ${jobId} failed:`, failedReason);

    try {
      const rawId = (data?.whoisDbId || data?.recordId)?.toString();
      const match = rawId?.match(/\d+$/);
      const whoisId = match ? parseInt(match[0], 10) : null;

      if (whoisId && !Number.isNaN(whoisId)) {
        // Only touches rows that are not already completed/failed (never overwrites a result)
        await prisma.whoisLookup.updateMany({
          where: { id: whoisId, status: { notIn: ["completed", "failed"] } },
          data: {
            status: "failed",
            error: failedReason || "WHOIS lookup failed",
            completedAt: new Date(),
          },
        }).catch((err) => {
          console.error(`[whoisLookup] DB update error on failed event for job ${jobId}:`, err);
        });
      }

      let userRoom = data?.roomId;
      let doc = null;
      if (whoisId && !Number.isNaN(whoisId)) {
        doc = await prisma.whoisLookup.findFirst({ where: { id: whoisId } }).catch(() => null);
        if (!userRoom) {
          userRoom = doc?.roomId || (doc?.userId ? `user:${doc.userId}` : doc?.guestId ? `guest:${doc.guestId}` : null);
        }
      }

      if (!userRoom) {
        console.warn(`[whoisLookup] No room found for failed job ${jobId}`);
        return;
      }

      const whoisDbId = (doc ? doc.id.toString() : (whoisId ? whoisId.toString() : jobId));
      const errorMsg = doc?.error || failedReason || "WHOIS lookup failed";
      const payload = {
        jobId,
        whoisDbId,
        recordId: whoisDbId,
        roomId: userRoom,
        status: "failed",
        error: errorMsg,
        result: {
          status: "failed",
          error: errorMsg,
        },
      };

      const sockets = await io.in(userRoom).fetchSockets();
      if (!sockets || sockets.length === 0) {
        console.warn(`[whoisLookup] Room ${userRoom} has 0 connected sockets on fail for job ${jobId}.`);
      }

      io.to(userRoom).emit("whois:result", payload);
      io.to(userRoom).emit("whoisLookupFailed", payload);
      io.to(userRoom).emit("whoisLookup-failed", payload);

      console.log(`[whoisLookup] Failure emitted to room: ${userRoom} for job: ${jobId}`);
    } catch (err) {
      console.error(`[whoisLookup] Error handling failed event for job ${jobId}:`, err);
    }
  });

  // Start consuming only after the listeners above are attached
  queueEvent.start().catch((err) => {
    console.error("[whoisLookup] Failed to start completion listener:", err);
  });
};

export default whoisLookupResultHandler;
