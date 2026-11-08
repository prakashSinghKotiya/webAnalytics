import { runPageSpeed } from "../Services/psInsight.Service.js";
import { prisma } from "../config/db.prismaSQL.js";
import { boss, lighthouseQueueName } from "../queue/Lighthouse.queue.js";

const CONCURRENCY = Number(process.env.LIGHTHOUSE_WORKER_CONCURRENCY) || 4;

export const startLighthouseWorker = async () => {
  const workerId = await boss.work(
    lighthouseQueueName,
    {
      includeMetadata: true, // gives job.retrycount / job.retrylimit
      teamSize: CONCURRENCY, // fetch up to N jobs per poll
      teamConcurrency: CONCURRENCY, // run N jobs concurrently
      teamRefill: true, // refill slots as soon as a job finishes
      newJobCheckInterval: 500, // ms
    },
    async (job) => {
      console.log(`Processing Lighthouse job ${job.id} for:`, job.data);

      const {
        targetUrl,
        userId,
        guestId,
        roomId,
        lighthousedbId,
        ligthouseId,
        strategy = "mobile",
      } = job.data;

      const rawDbId = lighthousedbId || ligthouseId || job.data?.recordId || job.data?.id;
      let dbId = null;
      if (typeof rawDbId === "string") {
        const match = rawDbId.match(/\d+$/);
        if (match) dbId = parseInt(match[0], 10);
      } else if (typeof rawDbId === "number") {
        dbId = rawDbId;
      }

      const effectiveUserId = userId != null ? Number(userId) : null;
      const effectiveGuestId = guestId || null;
      const effectiveRoomId =
        roomId ||
        (effectiveUserId
          ? `user:${effectiveUserId}`
          : effectiveGuestId
          ? `guest:${effectiveGuestId}`
          : null);

      if (!targetUrl || !dbId || Number.isNaN(dbId) || (!effectiveUserId && !effectiveGuestId) || !effectiveRoomId) {
        throw new Error(
          `Invalid job data. targetUrl: ${targetUrl}, lighthousedbId: ${rawDbId}, actor: ${effectiveUserId || effectiveGuestId}, roomId: ${effectiveRoomId}`
        );
      }
      console.log(`[Lighthouse] Processing for room: ${effectiveRoomId}, dbId: ${dbId}`);

      try {
        // 1. Mark as processing in DB
        await prisma.lighthouse.update({
          where: { id: dbId },
          data: {
            status: "processing",
          },
        }).catch((err) => {
          if (err.code === "P2025") return null;
          throw err;
        });

        // 2. Run PageSpeed analysis
        const result = await runPageSpeed(targetUrl, { strategy });

        const isSuccess = Boolean(result && result.status !== "failed");
        const errorMessage = isSuccess ? null : (result?.error || "Lighthouse analysis failed");

        // 3. Save result and status in PostgreSQL
        await prisma.lighthouse.update({
          where: { id: dbId },
          data: {
            status: isSuccess ? "completed" : "failed",
            result: result || undefined,
            error: errorMessage,
            completedAt: new Date(),
          },
        }).catch((err) => {
          if (err.code === "P2025") return null;
          throw err;
        });

        console.log(`[Lighthouse] Job ${job.id} completed successfully with status: ${isSuccess ? "completed" : "failed"}`);

        // Returned value is delivered to the pg-boss completion listener
        return {
          jobId: job.id,
          userId: effectiveUserId,
          guestId: effectiveGuestId,
          roomId: effectiveRoomId,
          lighthousedbId: dbId.toString(),
          strategy,
          result,
          status: isSuccess ? "completed" : "failed",
          error: errorMessage,
        };
      } catch (err) {
        console.error(`[Lighthouse] Error processing job ${job.id}:`, err);

        // Only mark the row failed on the LAST attempt; earlier attempts will be retried
        const isLastAttempt = job.retrycount >= job.retrylimit;
        if (isLastAttempt && dbId && !Number.isNaN(dbId)) {
          try {
            await prisma.lighthouse.update({
              where: { id: dbId },
              data: {
                status: "failed",
                error: err.message || "Lighthouse analysis failed",
                completedAt: new Date(),
              },
            }).catch((dbErr) => {
              if (dbErr.code !== "P2025") {
                console.error("[Lighthouse] DB update failed on job error:", dbErr);
              }
            });
          } catch (dbErr) {
            console.error("[Lighthouse] DB update failed on job error:", dbErr);
          }
        }

        throw err; // pg-boss retries or marks the job failed and emits completion
      }
    }
  );

  return {
    workerId,
    close: async () => boss.offWork(workerId),
  };
};

export default startLighthouseWorker;
