import { Worker } from "bullmq";
import { redisConnectionOptions } from "../config/redis.js";
import { checkUrl } from "../Services/uptimeChecker.Service.js";
import { UptimeMonitor } from "../Models/UptimeMonitor.Model.js";
import { UptimeResult } from "../Models/UptimeResults.Model.js";

export const startUptimeWorker = () => {
  const worker = new Worker(
    "uptimeRobot-india",
    async (job) => {
      console.log("Processing uptimeMonitor for :", job.data);

      const { monitorId, url, userId, roomId } = job.data;

      if (!url || !monitorId) {
        throw new Error(`Invalid job data. monitorId: ${monitorId}, URL: ${url}`);
      }

      const targetRoomId = roomId || (userId ? `user:${userId}` : null);
      const checkedAt = new Date();

      if (!userId) {
        throw new Error(`Missing userId in job data for monitor ${monitorId}`);
      }

      // 1. Run the check: a site error becomes a DOWN result, not a job failure
      let result;
      try {
        result = await checkUrl(url);
      } catch (error) {
        console.error(`[Uptime] Check failed for ${url} (monitor ${monitorId}):`, error.message);
        result = { status: "DOWN", error: error.message || "Uptime check failed" };
      }

      const isUp = Boolean(result && result.status !== "DOWN");

      // 2. Save history + latest result
      await Promise.all([
        UptimeResult.create({ monitorId, userId, result, checkedAt }),
        UptimeMonitor.findByIdAndUpdate(monitorId, {
          $set: { lastResult: result, lastCheckedAt: checkedAt },
        }),
      ]);

      // 3. Job completes for both UP and DOWN
      return {
        jobId: job.id,
        monitorId,
        userId,
        roomId: targetRoomId,
        url,
        result,
        status: isUp ? "up" : "down",
      };
    },
    {
      connection: redisConnectionOptions,
      concurrency: 10,
    }
  );

  worker.on("completed", (job) => {
    console.log(`Uptime job ${job.id} completed`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Uptime job ${job?.id} failed:`, error.message);
  });

  worker.on("error", (error) => {
    console.error("Uptime worker error:", error);
  });

  return worker;
};

export default startUptimeWorker;