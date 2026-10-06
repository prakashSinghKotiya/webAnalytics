import { Worker } from "bullmq";
import { sharedWorkerRedisConnection } from "../config/redis.js";
import { runPageSpeed } from "../Services/psInsight.Service.js";
import { Lighthouse } from "../Models/Lighthouse.Model.js";

const lightHouseworker = new Worker(
  "lighthouse-queue",
  async (job) => {
    console.log(`Processing Lighthouse job ${job.id} for:`, job.data);

    const {
      targetUrl,
      userId,
      lighthousedbId,
      ligthouseId,
      strategy = "mobile",
    } = job.data;
    const dbId = lighthousedbId || ligthouseId;

    if (!targetUrl || !dbId || !userId) {
      throw new Error(
        `Invalid job data. targetUrl: ${targetUrl}, lighthousedbId: ${dbId}, userId: ${userId}`
      );
    }

    try {
      // Mark as processing in DB
      await Lighthouse.findByIdAndUpdate(dbId, {
        status: "processing",
      });

      const result = await runPageSpeed(targetUrl, { strategy });

      const isSuccess = Boolean(result && result.status !== "failed");

      // Save result and status in MongoDB
      await Lighthouse.findByIdAndUpdate(dbId, {
        status: isSuccess ? "completed" : "failed",
        result,
        error: isSuccess ? null : (result?.error || "Lighthouse analysis failed"),
        completedAt: new Date(),
      });

      console.log(`[Lighthouse] Job ${job.id} completed successfully`);

      return {
        jobId: job.id,
        userId,
        lighthousedbId: dbId,
        strategy,
        result,
        status: isSuccess ? "completed" : "failed",
      };
    } catch (err) {
      console.error(`[Lighthouse] Error processing job ${job.id}:`, err);

      if (dbId) {
        try {
          await Lighthouse.findByIdAndUpdate(dbId, {
            status: "failed",
            error: err.message || "Lighthouse analysis failed",
            completedAt: new Date(),
          });
        } catch (dbErr) {
          console.error("[Lighthouse] DB update failed on job error:", dbErr);
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

lightHouseworker.on("completed", (job) => {
  console.log(`[Lighthouse] Job ${job?.id} completed successfully`);
});

lightHouseworker.on("failed", (job, error) => {
  console.error(`[Lighthouse] Job ${job?.id} failed:`, error?.message);
});

lightHouseworker.on("error", (error) => {
  console.error("[Lighthouse] Worker error:", error?.message);
});

process.on("SIGINT", async () => {
  console.log("Shutting down Lighthouse worker safely...");
  await lightHouseworker.close();
  lightHouseworker.removeAllListeners();
  process.exit(0);
});

export default lightHouseworker;
export { lightHouseworker };