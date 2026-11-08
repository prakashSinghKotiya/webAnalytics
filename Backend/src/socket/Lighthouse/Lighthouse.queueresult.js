import { LighthouequeueListner } from "../../queue/Lighthouse.QueueListner.js";
import { prisma } from "../../config/db.prismaSQL.js";

// Handling pg-boss queue events when Lighthouse jobs complete or fail
export const LighthouseResultHandler = (io) => {
  handleQueueEvent(LighthouequeueListner, io);
};

export const setupLighthouseQueueResult = LighthouseResultHandler;

export const handleQueueEvent = (queueEvent, io) => {
  // Connection / stream error handler to avoid unhandled EventEmitter exceptions
  queueEvent.on("error", (err) => {
    console.error("[Lighthouse] QueueEvents error:", err);
  });

  // Completed job event - result comes straight from the worker's return value
  queueEvent.on("completed", async ({ jobId, returnvalue, returnValue }) => {
    try {
      const raw = returnvalue || returnValue;
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (!data) {
        console.warn(`[Lighthouse] No returnvalue data found for job ${jobId}`);
        return;
      }

      let userRoom =
        data.roomId ||
        (data.userId ? `user:${data.userId}` : data.guestId ? `guest:${data.guestId}` : null);

      // Fallback to DB record if userRoom is missing
      if (!userRoom && (data.lighthousedbId || data.recordId)) {
        const rawId = (data.lighthousedbId || data.recordId).toString();
        const match = rawId.match(/\d+$/);
        const id = match ? parseInt(match[0], 10) : null;
        if (id && !Number.isNaN(id)) {
          const doc = await prisma.lighthouse.findUnique({ where: { id } }).catch(() => null);
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
        console.warn(`[Lighthouse] No room found for completed job ${jobId}`);
        return;
      }

      const lighthousedbId = (data.lighthousedbId || data.recordId || jobId).toString();
      const payload = {
        jobId,
        lighthousedbId,
        roomId: userRoom,
        strategy: data.strategy,
        result: data.result,
        status: data.status || "completed",
        error: data.error || null,
      };

      const sockets = await io.in(userRoom).fetchSockets();
      if (!sockets || sockets.length === 0) {
        console.warn(`[Lighthouse] Room ${userRoom} has 0 connected sockets. Result is persisted in DB for job ${jobId}.`);
      } else {
        console.log(`[Lighthouse] Result emitted to ${sockets.length} socket(s) in room: ${userRoom} for job: ${jobId}`);
      }

      // Emit standard and legacy events
      io.to(userRoom).emit("lighthouse:result", payload);
      io.to(userRoom).emit("lighthouseCompleted", payload);
      io.to(userRoom).emit("Lighthouse-completed", payload);
    } catch (err) {
      console.error(`[Lighthouse] Error processing completed event for job ${jobId}:`, err);
    }
  });

  // Failed job event - fires once after retries are used up (or the job expired)
  queueEvent.on("failed", async ({ jobId, failedReason, data }) => {
    console.error(`[Lighthouse] Job ${jobId} failed:`, failedReason);

    try {
      const rawId = (data?.lighthousedbId || data?.ligthouseId || data?.recordId)?.toString();
      const match = rawId?.match(/\d+$/);
      let lighthouseId = match ? parseInt(match[0], 10) : null;
      if (!lighthouseId || Number.isNaN(lighthouseId)) {
        if (typeof jobId === "string") {
          const m = jobId.match(/\d+$/);
          if (m) lighthouseId = parseInt(m[0], 10);
        } else if (typeof jobId === "number") {
          lighthouseId = jobId;
        }
      }

      if (lighthouseId && !Number.isNaN(lighthouseId)) {
        // Only touches rows that are not already completed/failed (never overwrites a result)
        await prisma.lighthouse.updateMany({
          where: { id: lighthouseId, status: { notIn: ["completed", "failed"] } },
          data: {
            status: "failed",
            error: failedReason || "Lighthouse analysis failed",
            completedAt: new Date(),
          },
        }).catch((err) => {
          console.error(`[Lighthouse] DB update error on failed event for job ${jobId}:`, err);
        });
      }

      let userRoom = data?.roomId;
      let doc = null;
      if (lighthouseId && !Number.isNaN(lighthouseId)) {
        doc = await prisma.lighthouse.findUnique({ where: { id: lighthouseId } }).catch(() => null);
        if (!userRoom) {
          userRoom = doc?.roomId || (doc?.userId ? `user:${doc.userId}` : doc?.guestId ? `guest:${doc.guestId}` : null);
        }
      }

      if (!userRoom && data?.userId) userRoom = `user:${data.userId}`;
      if (!userRoom && data?.guestId) userRoom = `guest:${data.guestId}`;

      if (!userRoom) {
        console.warn(`[Lighthouse] No room found for failed job ${jobId}`);
        return;
      }

      const errorMsg = doc?.error || failedReason || "Lighthouse analysis failed";
      const failPayload = {
        jobId,
        lighthousedbId: doc ? doc.id.toString() : (lighthouseId ? lighthouseId.toString() : jobId),
        roomId: userRoom,
        result: {
          status: "failed",
          error: errorMsg,
        },
        error: errorMsg,
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
    } catch (err) {
      console.error(`[Lighthouse] Error processing failed event for job ${jobId}:`, err);
    }
  });

  // Start consuming only after the listeners above are attached
  queueEvent.start().catch((err) => {
    console.error("[Lighthouse] Failed to start completion listener:", err);
  });
};

export const lighthouseevent = handleQueueEvent;
export default LighthouseResultHandler;
