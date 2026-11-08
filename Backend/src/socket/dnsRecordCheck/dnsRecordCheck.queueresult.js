import { dnsRecordCheckListener } from "../../queue/dnsRecordCheck.QeventListner.js";
import { prisma } from "../../config/db.prismaSQL.js";

// Handling pg-boss queue events when DNS record jobs complete or fail
export const dnsRecordCheckResultHandler = (io) => {
  handleDnsQueueEvent(dnsRecordCheckListener, io);
};

export const setupDnsRecordQueueResult = dnsRecordCheckResultHandler;

export const handleDnsQueueEvent = (queueEvent, io) => {
  // Connection / stream error handler to avoid unhandled EventEmitter exceptions
  queueEvent.on("error", (err) => {
    console.error("[dnsRecordCheck] QueueEvents error:", err);
  });

  // Completed job event - result comes straight from the worker's return value
  queueEvent.on("completed", async ({ jobId, returnvalue, returnValue }) => {
    try {
      const raw = returnvalue || returnValue;
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (!data) {
        console.warn(`[dnsRecordCheck] No returnvalue data found for job ${jobId}`);
        return;
      }

      let userRoom =
        data.roomId ||
        (data.userId ? `user:${data.userId}` : data.guestId ? `guest:${data.guestId}` : null);

      // Fallback to DB record if userRoom is missing
      if (!userRoom && (data.dnsRecordId || data.recordId)) {
        const rawId = (data.dnsRecordId || data.recordId).toString();
        const match = rawId.match(/\d+$/);
        const id = match ? parseInt(match[0], 10) : null;
        if (id && !Number.isNaN(id)) {
          const doc = await prisma.dnsRecord.findUnique({ where: { id } }).catch(() => null);
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
        console.warn(`[dnsRecordCheck] No room found for completed job ${jobId}`);
        return;
      }

      const dnsRecordId = (data.dnsRecordId || data.recordId || jobId).toString();
      const payload = {
        jobId,
        dnsRecordId,
        roomId: userRoom,
        result: data.result,
        status: data.status || "completed",
        error: data.error || null,
      };

      const sockets = await io.in(userRoom).fetchSockets();
      if (!sockets || sockets.length === 0) {
        console.warn(`[dnsRecordCheck] Room ${userRoom} has 0 connected sockets. Result is persisted in DB for job ${jobId}.`);
      } else {
        console.log(`[dnsRecordCheck] Result emitted to ${sockets.length} socket(s) in room: ${userRoom} for job: ${jobId}`);
      }

      // Emit standard and legacy events
      io.to(userRoom).emit("dns:result", payload);
      io.to(userRoom).emit("dnsRecordCompleted", payload);
      io.to(userRoom).emit("dnsRecordCheck-completed", payload);
    } catch (err) {
      console.error(`[dnsRecordCheck] Error processing completed event for job ${jobId}:`, err);
    }
  });

  // Failed job event - fires once after retries are used up (or the job expired)
  queueEvent.on("failed", async ({ jobId, failedReason, data }) => {
    console.error(`[dnsRecordCheck] Job ${jobId} failed:`, failedReason);

    try {
      const rawId = (data?.dnsRecordId || data?.recordId)?.toString();
      const match = rawId?.match(/\d+$/);
      let dnsId = match ? parseInt(match[0], 10) : null;
      if (!dnsId || Number.isNaN(dnsId)) {
        if (typeof jobId === "string") {
          const m = jobId.match(/\d+$/);
          if (m) dnsId = parseInt(m[0], 10);
        } else if (typeof jobId === "number") {
          dnsId = jobId;
        }
      }

      if (dnsId && !Number.isNaN(dnsId)) {
        // Only touches rows that are not already completed/failed (never overwrites a result)
        await prisma.dnsRecord.updateMany({
          where: { id: dnsId, status: { notIn: ["completed", "failed"] } },
          data: {
            status: "failed",
            error: failedReason || "DNS record check failed",
            completedAt: new Date(),
          },
        }).catch((err) => {
          console.error(`[dnsRecordCheck] DB update error on failed event for job ${jobId}:`, err);
        });
      }

      let userRoom = data?.roomId;
      let doc = null;
      if (dnsId && !Number.isNaN(dnsId)) {
        doc = await prisma.dnsRecord.findUnique({ where: { id: dnsId } }).catch(() => null);
        if (!userRoom) {
          userRoom = doc?.roomId || (doc?.userId ? `user:${doc.userId}` : doc?.guestId ? `guest:${doc.guestId}` : null);
        }
      }

      if (!userRoom && data?.userId) userRoom = `user:${data.userId}`;
      if (!userRoom && data?.guestId) userRoom = `guest:${data.guestId}`;

      if (!userRoom) {
        console.warn(`[dnsRecordCheck] No room found for failed job ${jobId}`);
        return;
      }

      const errorMsg = doc?.error || failedReason || "DNS record check failed";
      const failPayload = {
        jobId,
        dnsRecordId: doc ? doc.id.toString() : (dnsId ? dnsId.toString() : jobId),
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
        console.warn(`[dnsRecordCheck] Room ${userRoom} has 0 connected sockets on fail for job ${jobId}.`);
      }

      io.to(userRoom).emit("dns:result", failPayload);
      io.to(userRoom).emit("dnsRecordFailed", failPayload);
      io.to(userRoom).emit("dnsRecordCheck-failed", failPayload);

      console.log(`[dnsRecordCheck] Failure event emitted to room: ${userRoom} for job: ${jobId}`);
    } catch (err) {
      console.error(`[dnsRecordCheck] Error processing failed event for job ${jobId}:`, err);
    }
  });

  // Start consuming only after the listeners above are attached
  queueEvent.start().catch((err) => {
    console.error("[dnsRecordCheck] Failed to start completion listener:", err);
  });
};

export default dnsRecordCheckResultHandler;
