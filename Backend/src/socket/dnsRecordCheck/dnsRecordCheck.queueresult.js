import { dnsRecordCheck, dnsRecordCheckListener } from "../../queue/dnsRecordCheck.Queue.js";
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

      const userId = data.userId;
      if (!userId) {
        console.warn(`[dnsRecordCheck] No userId present in job ${jobId} returnvalue`);
        return;
      }

      const userRoom = `user:${userId}`;
      const payload = {
        jobId,
        dnsRecordId: data.dnsRecordId || jobId,
        roomId: userRoom,
        result: data.result,
        status: data.status || "completed",
      };

      // Emit to user room (supporting both naming conventions for compatibility)
      io.to(userRoom).emit("dnsRecordCompleted", payload);
      io.to(userRoom).emit("dnsRecordCheck-completed", payload);

      console.log(`[dnsRecordCheck] Result emitted to room: ${userRoom} for job: ${jobId}`);
    } catch (err) {
      console.error(`[dnsRecordCheck] Error processing completed event for job ${jobId}:`, err);
    }
  });

  // Failed 
  queueEvent.on("failed", async ({ jobId, failedReason }) => {
      console.error(`[DNSRecordCheck ${region}] Job ${jobId} failed:`, failedReason);
  
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
  
        if (dnsDoc?.userId) {
          const userRoom = `user:${dnsDoc.userId}`;
          io.to(userRoom).emit("dnsRecordCheckFailed", {
            jobId,
            roomId: userRoom,
            region: dnsDoc.region || region,
            result: {
              region: dnsDoc.region || region,
              status: "failed",
              error: failedReason || "DNS record check failed",
            },
            status: "failed",
          });
        }
      } catch (err) {
        console.error(`[DNSRecordCheck ${region}] Error processing failed event for job ${jobId}:`, err);
      }
    });
};


