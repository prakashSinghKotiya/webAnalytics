import { Worker } from "bullmq";
import { sharedWorkerRedisConnection } from "../config/redis.js";
import { checkDnsRecords } from "../Services/dnsRecordtype.Service.js";
import { DnsRecord } from "../Models/dnsRecord.Model.js";

export const startDnsWorker = () => {
  const worker = new Worker(
    "dnsRecordCheck-queue",
    async (job) => {
      console.log(`Processing DNS record job ${job.id} for:`, job.data);

      const { targetUrl, userId, guestId, dnsRecordId, recordId, roomId } = job.data;
      const dbId = dnsRecordId || recordId;
      const targetRoomId = roomId || (userId ? `user:${userId}` : guestId ? `guest:${guestId}` : null);

      if (!targetUrl || !dbId || (!userId && !guestId)) {
        throw new Error(
          `Invalid job data. TargetUrl: ${targetUrl}, dnsRecordId: ${dbId}, actor: ${userId || guestId}`
        );
      }

      try {
        // Mark as processing in DB
        await DnsRecord.findByIdAndUpdate(dbId, {
          status: "processing",
        });

        const result = await checkDnsRecords(targetUrl);
        console.log(`[dnsRecordCheck] Job ${job.id} result:`, result);

        const isSuccess = Boolean(result && (!result.status || result.status !== "failed"));

        // Update MongoDB document with DNS lookup result
        await DnsRecord.findByIdAndUpdate(dbId, {
          status: isSuccess ? "completed" : "failed",
          result,
          error: isSuccess ? null : (result?.error || "DNS lookup failed"),
          completedAt: new Date(),
        });

        console.log(`[dnsRecordCheck] Job ${job.id} completed successfully`);

        return {
          jobId: job.id,
          userId,
          guestId,
          roomId: targetRoomId,
          dnsRecordId: dbId,
          result,
          status: isSuccess ? "completed" : "failed",
        };
      } catch (error) {
        console.error(`[dnsRecordCheck] Error processing job ${job.id}:`, error);

        if (dbId) {
          try {
            await DnsRecord.findByIdAndUpdate(dbId, {
              status: "failed",
              error: error.message || "DNS lookup failed",
              completedAt: new Date(),
            });
          } catch (dbErr) {
            console.error("[dnsRecordCheck] DB update failed on job error:", dbErr);
          }
        }

        throw error;
      }
    },
    {
      connection: sharedWorkerRedisConnection,
      concurrency: 10,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[dnsRecordCheck] Job ${job?.id} completed successfully`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[dnsRecordCheck] Job ${job?.id} failed:`, error?.message);
  });

  worker.on("error", (error) => {
    console.error("[dnsRecordCheck] Worker error:", error?.message);
  });

  return worker;
};

export default startDnsWorker;