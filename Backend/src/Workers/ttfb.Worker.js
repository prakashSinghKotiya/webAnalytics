import { Worker } from "bullmq";
import { sharedWorkerRedisConnection } from "../config/redis.js";
import { measureTTFB } from "../Services/ttfb.Service.js";
import { Ttfb } from "../Models/Ttfb.Model.js";

export const startTtfbWorker = (region) => {
  const queueName = `ttfb-${region}`;

  const worker = new Worker(
    queueName,
    async (job) => {
      console.log(`Processing TTFB job ${job.id} for region: ${region}`);

      const { targetUrl, userId, guestId, roomId, ttfbdbId, region: jobRegion } = job.data;
      const targetRegion = jobRegion || region;

      if (!targetUrl || !ttfbdbId || (!userId && !guestId) || !roomId) {
        throw new Error(
          `Invalid job data. TargetUrl: ${targetUrl}, ttfbdbId: ${ttfbdbId}, actor: ${userId || guestId}`
        );
      }

      try {
        const result = await measureTTFB(targetUrl);
        console.log(`[${targetRegion}] TTFB result:`, result);

        const isSuccess = Boolean(result && result.success);

        // Update MongoDB document with measurement result
        await Ttfb.findByIdAndUpdate(ttfbdbId, {
          status: isSuccess ? "completed" : "failed",
          result,
          error: isSuccess ? null : (result?.error || "TTFB measurement failed"),
          completedAt: new Date(),
        });

        return {
          jobId: job.id,
          userId,
          guestId,
          roomId,
          ttfbdbId,
          region: targetRegion,
          result,
          status: isSuccess ? "completed" : "failed",
        };
      } catch (error) {
        console.error(`[${targetRegion}] Error processing job ${job.id}:`, error);

        if (ttfbdbId) {
          try {
            await Ttfb.findByIdAndUpdate(ttfbdbId, {
              status: "failed",
              error: error.message || "Worker execution failed",
              completedAt: new Date(),
            });
          } catch (dbErr) {
            console.error(`[${targetRegion}] DB update failed on job error:`, dbErr);
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

  worker.on("completed", (job, result) => {
    console.log(`[${region}] Job ${job.id} completed successfully`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[${region}] Job ${job?.id} failed:`, error?.message);
  });

  worker.on("error", (error) => {
    console.error(`[${region}] Worker error:`, error?.message);
  });

  return worker;
};

export default startTtfbWorker;
