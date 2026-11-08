import { checkDnsRecords } from "../Services/dnsRecordtype.Service.js";
import { prisma } from "../config/db.prismaSQL.js";
import { boss, dnsRecordQueueName } from "../queue/dnsRecordCheck.Queue.js";

const CONCURRENCY = Number(process.env.DNS_WORKER_CONCURRENCY) || 10;

export const startDnsWorker = async () => {
  const workerId = await boss.work(
    dnsRecordQueueName,
    {
      includeMetadata: true, // gives job.retrycount / job.retrylimit
      teamSize: CONCURRENCY, // fetch up to N jobs per poll
      teamConcurrency: CONCURRENCY, // run N jobs concurrently
      teamRefill: true, // refill slots as soon as a job finishes
      newJobCheckInterval: 500, // ms
    },
    async (job) => {
      console.log(`Processing DNS record job ${job.id} for:`, job.data);

      const { targetUrl, userId, guestId, dnsRecordId, recordId, roomId } = job.data;
      const dbId = dnsRecordId || recordId || job.data?.id;
      const effectiveUserId = userId != null ? Number(userId) : null;
      const effectiveGuestId = guestId || null;
      const targetRoomId =
        roomId ||
        (effectiveUserId
          ? `user:${effectiveUserId}`
          : effectiveGuestId
          ? `guest:${effectiveGuestId}`
          : null);

      if (!targetUrl || !dbId || (!effectiveUserId && !effectiveGuestId) || !targetRoomId) {
        throw new Error(
          `Invalid job data. TargetUrl: ${targetUrl}, dnsRecordId: ${dbId}, actor: ${effectiveUserId || effectiveGuestId}, roomId: ${targetRoomId}`
        );
      }
      console.log(`[dnsRecordCheck] Processing for room: ${targetRoomId}, dbId: ${dbId}`);

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
          await prisma.dnsRecord.update({
            where: { id },
            data: {
              status: "processing",
            },
          }).catch((err) => {
            if (err.code === "P2025") return null;
            throw err;
          });
        }

        // 2. Perform DNS queries
        const result = await checkDnsRecords(targetUrl);
        console.log(`[dnsRecordCheck] Job ${job.id} result came`);

        const isSuccess = Boolean(result && (!result.status || result.status !== "failed"));
        const errorMessage = isSuccess ? null : (result?.error || "DNS lookup failed");

        // 3. Update PostgreSQL record with DNS lookup result
        if (id && !Number.isNaN(id)) {
          await prisma.dnsRecord.update({
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

        console.log(`[dnsRecordCheck] Job ${job.id} completed successfully with status: ${isSuccess ? "completed" : "failed"}`);

        // Returned value is delivered to the pg-boss completion listener
        return {
          jobId: job.id,
          userId: effectiveUserId,
          guestId: effectiveGuestId,
          roomId: targetRoomId,
          dnsRecordId: (id ?? dbId).toString(),
          result,
          status: isSuccess ? "completed" : "failed",
          error: errorMessage,
        };
      } catch (error) {
        console.error(`[dnsRecordCheck] Error processing job ${job.id}:`, error);

        // Only mark the row failed on the LAST attempt; earlier attempts will be retried
        const isLastAttempt = job.retrycount >= job.retrylimit;
        if (isLastAttempt && id && !Number.isNaN(id)) {
          try {
            await prisma.dnsRecord.update({
              where: { id },
              data: {
                status: "failed",
                error: error.message || "DNS lookup failed",
                completedAt: new Date(),
              },
            }).catch((dbErr) => {
              if (dbErr.code !== "P2025") {
                console.error("[dnsRecordCheck] DB update failed on job error:", dbErr);
              }
            });
          } catch (dbErr) {
            console.error("[dnsRecordCheck] DB update failed on job error:", dbErr);
          }
        }

        throw error; // pg-boss retries or marks the job failed and emits completion
      }
    }
  );

  return {
    workerId,
    close: async () => boss.offWork(workerId),
  };
};

export default startDnsWorker;
