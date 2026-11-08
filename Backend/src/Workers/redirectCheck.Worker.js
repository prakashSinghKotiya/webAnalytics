import { findRedirects } from "../Services/redirectCheck.Service.js";
import { prisma } from "../config/db.prismaSQL.js";
import { boss, redirectQueueName } from "../queue/redirectCheck.Queue.js";

const CONCURRENCY = Number(process.env.REDIRECT_WORKER_CONCURRENCY) || 10;

export const startRedirectWorker = async () => {
  const workerId = await boss.work(
    redirectQueueName,
    {
      includeMetadata: true, // gives job.retrycount / job.retrylimit
      teamSize: CONCURRENCY, // fetch up to N jobs per poll
      teamConcurrency: CONCURRENCY, // run N jobs concurrently
      teamRefill: true, // refill slots as soon as a job finishes
      newJobCheckInterval: 500, // ms
    },
    async (job) => {
      console.log(`Processing redirect check job ${job.id} for:`, job.data);

      const {
        targetUrl,
        userId,
        guestId,
        redirectCheckId,
        recordId,
        roomId,
      } = job.data;

      const dbId = redirectCheckId || recordId;
      const effectiveUserId = userId;
      const effectiveGuestId = guestId;
      const effectiveRoomId =
        roomId ||
        (effectiveUserId
          ? `user:${effectiveUserId}`
          : effectiveGuestId
          ? `guest:${effectiveGuestId}`
          : null);

      if (!targetUrl || !dbId) {
        throw new Error(
          `Invalid job data. targetUrl: ${targetUrl}, redirectCheckId: ${dbId}`
        );
      }

      let id = null;
      if (typeof dbId === "string") {
        const match = dbId.match(/\d+$/);
        if (match) id = parseInt(match[0], 10);
      } else if (typeof dbId === "number") {
        id = dbId;
      }

      try {
        // 1. Mark as processing in DB
        if (id && !Number.isNaN(id)) {
          await prisma.redirectCheck.update({
            where: { id },
            data: {
              status: "processing",
            },
          }).catch(() => {});
        }

        // 2. Perform redirect check
        const result = await findRedirects(targetUrl);
        console.log(`[redirectCheck] Job ${job.id} result:`, result);

        const isSuccess = Boolean(result && result.success !== false && !result.error);
        const errorMessage = isSuccess
          ? null
          : (result?.message || result?.error || "Redirect check failed");

        // 3. Save result and status in PostgreSQL
        if (id && !Number.isNaN(id)) {
          await prisma.redirectCheck.update({
            where: { id },
            data: {
              status: isSuccess ? "completed" : "failed",
              result,
              error: errorMessage,
              completedAt: new Date(),
            },
          }).catch((err) => {
            if (err.code === "P2025") return null;
            throw err;
          });
        }

        console.log(`[redirectCheck] Job ${job.id} completed with status: ${isSuccess ? "completed" : "failed"}`);

        // The returned value is delivered to the completion event listener
        return {
          jobId: job.id,
          userId: effectiveUserId,
          guestId: effectiveGuestId,
          redirectCheckId: dbId,
          recordId: dbId,
          roomId: effectiveRoomId,
          result,
          status: isSuccess ? "completed" : "failed",
          error: errorMessage,
        };
      } catch (err) {
        console.error(`[redirectCheck] Error processing job ${job.id}:`, err);

        // Only mark the row failed on the LAST attempt; earlier attempts will be retried
        const isLastAttempt = job.retrycount >= job.retrylimit;
        if (isLastAttempt && id && !Number.isNaN(id)) {
          try {
            await prisma.redirectCheck.update({
              where: { id },
              data: {
                status: "failed",
                error: err.message || "Redirect check failed",
                completedAt: new Date(),
              },
            }).catch(() => {});
          } catch (dbErr) {
            console.error("[redirectCheck] DB update failed on job error:", dbErr);
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

export default startRedirectWorker;
