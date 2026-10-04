import { Worker } from "bullmq";
import connection from "../config/redis.js";
import { measureTTFB } from "../Services/ttfb.Service.js";

export const startTtfbWorker = (region) => {
  const queueName = `ttfb-${region}`;

  const worker = new Worker(
    queueName,
    async (job) => {
      console.log(`Processing TTFB job ${job.id} for region: ${region}`);

      const { targetUrl, roomId } = job.data;
      if (!targetUrl || !roomId) {
        throw new Error(`Invalid job data. TargetUrl: ${targetUrl}, roomId: ${roomId}`);
      }

      try {
        const result = await measureTTFB(targetUrl);
        console.log(`[${region}] TTFB result:`, result);

        if (!result || !result.success) {
          return { region, roomId, ...result, status: "failed" };
        }

        return { region, roomId, ...result };
      } catch (error) {
        console.error(`[${region}] Error processing job:`, error);
        throw error;
      }
    },
    {
      connection: { ...connection },
      concurrency: 10,
    }
  );

  worker.on("completed", (job, result) => {
    console.log(`[${region}] Job ${job.id} completed:`, result);
  });

  worker.on("failed", (job, error) => {
    console.error(`[${region}] Job ${job?.id} failed:`, error.message);
  });

  worker.on("error", (error) => {
    console.error(`[${region}] Worker error:`, error.message);
  });
};