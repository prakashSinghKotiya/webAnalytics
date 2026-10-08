import { dnsRecordCheck } from "../../queue/dnsRecordCheck.Queue.js";
import { dnsRecordCheckListener } from "../../queue/dnsRecordCheck.QeventListner.js";
import { DnsRecord } from "../../Models/dnsRecord.Model.js";

// Handling BullMQ queue events when DNS record jobs complete or fail
export const dnsRecordCheckResultHandler = (io) => {
  handleDnsQueueEvent(dnsRecordCheckListener, io);
};

export const setupDnsRecordQueueResult = dnsRecordCheckResultHandler;

export const handleDnsQueueEvent = (queueEvent, io) => {
  // Connection / stream error handler to avoid unhandled EventEmitter exceptions
  queueEvent.on("error", (err) => {
    console.error("[dnsRecordCheck] QueueEvents error:", err);
  });

  queueEvent.on("completed", async ({ jobId, returnvalue, returnValue }) => {
    try {
      let raw = returnvalue || returnValue;
      let data = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (!data) {
        console.warn(`[dnsRecordCheck] No returnvalue data found for job ${jobId}`);
        return;
      }

      const roomId =
        data.roomId ||
        (data.userId ? `user:${data.userId}` : data.guestId ? `guest:${data.guestId}` : null);

      if (!roomId) {
        console.warn(`[dnsRecordCheck] No roomId or actor present in job ${jobId} returnvalue`);
        return;
      }

      const payload = {
        jobId,
        dnsRecordId: data.dnsRecordId || jobId,
        roomId,
        result: data.result,
        status: data.status || "completed",
      };

      // Emit to destination room
      io.to(roomId).emit("dnsRecordCompleted", payload);
      io.to(roomId).emit("dnsRecordCheck-completed", payload);

      console.log(`[dnsRecordCheck] Result emitted to room: ${roomId} for job: ${jobId}`);
    } catch (err) {
      console.error(`[dnsRecordCheck] Error processing completed event for job ${jobId}:`, err);
    }
  });

  // Failed
  queueEvent.on("failed", async ({ jobId, failedReason }) => {
    console.error(`[dnsRecordCheck] Job ${jobId} failed:`, failedReason);

    try {
      const dnsDoc = await DnsRecord.findByIdAndUpdate(
        jobId,
        {
          status: "failed",
          error: failedReason || "DNS record check failed",
          completedAt: new Date(),
        },
        { new: true }
      ).lean();

      let targetRoom = dnsDoc?.roomId;
      if (!targetRoom && dnsDoc?.userId) {
        targetRoom = `user:${dnsDoc.userId}`;
      } else if (!targetRoom && dnsDoc?.guestId) {
        targetRoom = `guest:${dnsDoc.guestId}`;
      }

      if (targetRoom) {
        io.to(targetRoom).emit("dnsRecordFailed", {
          jobId,
          error: failedReason || "DNS record check failed",
        });
        io.to(targetRoom).emit("dnsRecordCheck-failed", {
          jobId,
          error: failedReason || "DNS record check failed",
        });
      }
    } catch (err) {
      console.error(`[dnsRecordCheck] Error processing failed event for job ${jobId}:`, err);
    }
  });
};

export default dnsRecordCheckResultHandler;
