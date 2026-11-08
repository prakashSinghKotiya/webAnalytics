import { redirectQueueListener } from "../../queue/redirectCheck.QeventListner.js";
import { prisma } from "../../config/db.prismaSQL.js";

// Handling pg-boss queue events when Redirect Check jobs complete or fail
export const redirectQueueResultHandler = (io) => {
  handleRedirectQueueEvent(redirectQueueListener, io);
};

export const setupRedirectQueueResult = redirectQueueResultHandler;

export const handleRedirectQueueEvent = (queueEvent, io) => {
  // Connection / stream error handler to avoid unhandled EventEmitter exceptions
  queueEvent.on("error", (err) => {
    console.error("[redirectCheck] QueueEvents error:", err);
  });

  // Completed job event - result comes straight from the worker's return value
  queueEvent.on("completed", async ({ jobId, returnvalue, returnValue }) => {
    try {
      const raw = returnvalue || returnValue;
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (!data) {
        console.warn(`[redirectCheck] No returnvalue data found for job ${jobId}`);
        return;
      }

      let userRoom =
        data.roomId ||
        (data.userId ? `user:${data.userId}` : data.guestId ? `guest:${data.guestId}` : null);

      // Fallback to DB record if userRoom is missing
      if (!userRoom && (data.redirectCheckId || data.recordId)) {
        const rawId = (data.redirectCheckId || data.recordId).toString();
        const match = rawId.match(/\d+$/);
        const id = match ? parseInt(match[0], 10) : null;
        if (id && !Number.isNaN(id)) {
          const doc = await prisma.redirectCheck.findFirst({ where: { id } }).catch(() => null);
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
        console.warn(`[redirectCheck] No room found for completed job ${jobId}`);
        return;
      }

      const redirectCheckId = (data.redirectCheckId || data.recordId || jobId).toString();
      const payload = {
        jobId,
        redirectCheckId,
        recordId: redirectCheckId,
        roomId: userRoom,
        result: data.result,
        status: data.status || "completed",
        error: data.error || null,
      };

      const sockets = await io.in(userRoom).fetchSockets();
      if (!sockets || sockets.length === 0) {
        console.warn(`[redirectCheck] Room ${userRoom} has 0 connected sockets. Result is persisted in DB for job ${jobId}.`);
      } else {
        console.log(`[redirectCheck] Result emitted to ${sockets.length} socket(s) in room: ${userRoom} for job: ${jobId}`);
      }

      // Emit standard and legacy events
      io.to(userRoom).emit("redirect:result", payload);
      io.to(userRoom).emit("redirectCheckCompleted", payload);
      io.to(userRoom).emit("redirect-completed", payload);
    } catch (err) {
      console.error(`[redirectCheck] Error handling completed event for job ${jobId}:`, err);
    }
  });

  // Failed job event - fires once after retries are used up (or job expired)
  queueEvent.on("failed", async ({ jobId, failedReason, data }) => {
    console.error(`[redirectCheck] Job ${jobId} failed:`, failedReason);

    try {
      const rawId = (data?.redirectCheckId || data?.recordId)?.toString();
      const match = rawId?.match(/\d+$/);
      const redirectId = match ? parseInt(match[0], 10) : null;

      if (redirectId && !Number.isNaN(redirectId)) {
        // Only touches rows that are not already completed/failed (never overwrites a result)
        await prisma.redirectCheck.updateMany({
          where: { id: redirectId, status: { notIn: ["completed", "failed"] } },
          data: {
            status: "failed",
            error: failedReason || "Redirect check failed",
            completedAt: new Date(),
          },
        }).catch((err) => {
          console.error(`[redirectCheck] DB update error on failed event for job ${jobId}:`, err);
        });
      }

      let userRoom = data?.roomId;
      let doc = null;
      if (redirectId && !Number.isNaN(redirectId)) {
        doc = await prisma.redirectCheck.findFirst({ where: { id: redirectId } }).catch(() => null);
        if (!userRoom) {
          userRoom = doc?.roomId || (doc?.userId ? `user:${doc.userId}` : doc?.guestId ? `guest:${doc.guestId}` : null);
        }
      }

      if (!userRoom) {
        console.warn(`[redirectCheck] No room found for failed job ${jobId}`);
        return;
      }

      const redirectCheckId = (doc ? doc.id.toString() : (redirectId ? redirectId.toString() : jobId));
      const errorMsg = doc?.error || failedReason || "Redirect check failed";
      const payload = {
        jobId,
        redirectCheckId,
        recordId: redirectCheckId,
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
        console.warn(`[redirectCheck] Room ${userRoom} has 0 connected sockets on fail for job ${jobId}.`);
      }

      io.to(userRoom).emit("redirect:result", payload);
      io.to(userRoom).emit("redirectCheckFailed", payload);
      io.to(userRoom).emit("redirect-failed", payload);

      console.log(`[redirectCheck] Failure emitted to room: ${userRoom} for job: ${jobId}`);
    } catch (err) {
      console.error(`[redirectCheck] Error handling failed event for job ${jobId}:`, err);
    }
  });

  // Start consuming only after the listeners above are attached
  queueEvent.start().catch((err) => {
    console.error("[redirectCheck] Failed to start completion listener:", err);
  });
};

export default redirectQueueResultHandler;
