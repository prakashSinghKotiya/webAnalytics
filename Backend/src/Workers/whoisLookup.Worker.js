import { Worker } from "bullmq";
import { redisConnectionOptions } from "../config/redis.js";
import { checkRDAPLookup } from "../Services/WhoisLookup.Service.js";
import { WhoisLookup } from "../Models/whoisLookup.Model.js";

export const startWhoisWorker = () => {
  const worker = new Worker(
    "whoisLookup-queue",
    async (job) => {
      console.log(`Processing WHOIS lookup job ${job.id} for:`, job.data);

      const {
        targetUrl,
        userId,
        guestId,
        whoisDbId,
        recordId,
        roomId,
        dbData,
      } = job.data;

      const dbId = whoisDbId || recordId || job.id;
      const effectiveUserId = userId || dbData?.userId;
      const effectiveGuestId = guestId || dbData?.guestId;
      const effectiveRoomId =
        roomId ||
        (effectiveUserId
          ? `user:${effectiveUserId}`
          : effectiveGuestId
          ? `guest:${effectiveGuestId}`
          : null);

      if (!targetUrl || !dbId) {
        throw new Error(
          `Invalid job data. targetUrl: ${targetUrl}, whoisDbId: ${dbId}`
        );
      }

      try {
        // 1. Mark as processing in DB
        await WhoisLookup.findByIdAndUpdate(dbId, {
          status: "processing",
        });

        // 2. Perform WHOIS / RDAP lookup
        const result = await checkRDAPLookup(targetUrl);
        console.log(`[whoisLookup] Job ${job.id} result:`, result);

        const isSuccess = Boolean(result && result.success !== false && !result.error);
        const errorMessage = isSuccess
          ? null
          : (result?.error?.message || result?.error?.code || result?.error || "WHOIS lookup failed");

        // 3. Save result and status in MongoDB
        await WhoisLookup.findByIdAndUpdate(dbId, {
          status: isSuccess ? "completed" : "failed",
          result,
          error: errorMessage,
          completedAt: new Date(),
        });

        console.log(`[whoisLookup] Job ${job.id} completed with status: ${isSuccess ? "completed" : "failed"}`);

        return {
          jobId: job.id,
          userId: effectiveUserId,
          guestId: effectiveGuestId,
          whoisDbId: dbId,
          recordId: dbId,
          roomId: effectiveRoomId,
          result,
          status: isSuccess ? "completed" : "failed",
          error: errorMessage,
        };
      } catch (err) {
        console.error(`[whoisLookup] Error processing job ${job.id}:`, err);

        if (dbId) {
          try {
            await WhoisLookup.findByIdAndUpdate(dbId, {
              status: "failed",
              error: err.message || "WHOIS lookup failed",
              completedAt: new Date(),
            });
          } catch (dbErr) {
            console.error("[whoisLookup] DB update failed on job error:", dbErr);
          }
        }

        throw err;
      }
    },
    {
      connection: redisConnectionOptions,
      concurrency: 10,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[whoisLookup] Job ${job?.id} completed successfully`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[whoisLookup] Job ${job?.id} failed:`, error?.message);
  });

  worker.on("error", (error) => {
    console.error("[whoisLookup] Worker error:", error?.message);
  });

  return worker;
};

export default startWhoisWorker;