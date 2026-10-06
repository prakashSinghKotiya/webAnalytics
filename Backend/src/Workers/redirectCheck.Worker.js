import { Worker } from "bullmq";
import { sharedWorkerRedisConnection } from "../config/redis.js";
import { findRedirects } from "../Services/redirectCheck.Service.js";
import { RedirectCheck } from "../Models/redirectCheck.Model.js";

const redirectCheck = new Worker(
  "redirect-queue",
  async (job) => {
    console.log(`Processing redirect check job ${job.id} for:`, job.data);

    const {
      targetUrl,
      userId,
      redirectCheckId,
      recordId,
      roomId,
      dbData,
    } = job.data;

    const dbId = redirectCheckId || recordId || job.id;
    const effectiveUserId = userId || dbData?.userId;
    const effectiveRoomId = roomId || (effectiveUserId ? `user:${effectiveUserId}` : null);

    if (!targetUrl || !dbId) {
      throw new Error(
        `Invalid job data. targetUrl: ${targetUrl}, redirectCheckId: ${dbId}`
      );
    }

    try {
      // 1. Mark as processing in DB
      await RedirectCheck.findByIdAndUpdate(dbId, {
        status: "processing",
      });

      // 2. Perform redirect check
      const result = await findRedirects(targetUrl);
      console.log(`[redirectCheck] Job ${job.id} result:`, result);

      const isSuccess = Boolean(result && result.success !== false && !result.error);

      // 3. Save result and status in MongoDB
      await RedirectCheck.findByIdAndUpdate(dbId, {
        status: isSuccess ? "completed" : "failed",
        result,
        error: isSuccess ? null : (result?.message || result?.error || "Redirect check failed"),
        completedAt: new Date(),
      });

      console.log(`[redirectCheck] Job ${job.id} completed with status: ${isSuccess ? "completed" : "failed"}`);

      return {
        jobId: job.id,
        userId: effectiveUserId,
        redirectCheckId: dbId,
        recordId: dbId,
        roomId: effectiveRoomId,
        result,
        status: isSuccess ? "completed" : "failed",
        error: isSuccess ? null : (result?.message || result?.error || "Redirect check failed"),
      };
    } catch (err) {
      console.error(`[redirectCheck] Error processing job ${job.id}:`, err);

      if (dbId) {
        try {
          await RedirectCheck.findByIdAndUpdate(dbId, {
            status: "failed",
            error: err.message || "Redirect check failed",
            completedAt: new Date(),
          });
        } catch (dbErr) {
          console.error("[redirectCheck] DB update failed on job error:", dbErr);
        }
      }

      throw err;
    }
  },
  {
    connection: sharedWorkerRedisConnection,
    concurrency: 10,
  }
);

redirectCheck.on("completed", (job) => {
  console.log(`[redirectCheck] Job ${job?.id} completed successfully`);
});

redirectCheck.on("failed", (job, error) => {
  console.error(`[redirectCheck] Job ${job?.id} failed:`, error?.message);
});

redirectCheck.on("error", (error) => {
  console.error("[redirectCheck] Worker error:", error?.message);
});

process.on("SIGINT", async () => {
  console.log("Shutting down redirect worker safely...");
  await redirectCheck.close();
  redirectCheck.removeAllListeners();
  process.exit(0);
});

export default redirectCheck;
export { redirectCheck };