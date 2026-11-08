import { measureTTFB } from "../Services/ttfb.Service.js";
import { prisma } from "../config/db.prismaSQL.js";
import { boss, ttfbQueues } from "../queue/ttfb.queue.js";

const CONCURRENCY = Number(process.env.TTFB_WORKER_CONCURRENCY) || 10;
const REMOTE_TIMEOUT_MS = 30000;

// local = isi server se measure, remote = Lambda ko HTTP se bhejo
const REGION_CONFIG = {
  india: { type: "local" },
  singapore: { type: "remote", url: process.env.LAMBDA_SG_URL, secret:process.env.WORKER_SECRET },
  canada: { type: "remote", url: process.env.LAMBDA_SG_URL_CA, secret:process.env.WORKER_SECRET_CA },
  
};

async function measureRemote(url, targetUrl,secret) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-worker-secret": secret,
      },
      body: JSON.stringify({ targetUrl }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Remote returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const startTtfbWorker = async (region) => {
  const cfg = REGION_CONFIG[region];
  if (!cfg) throw new Error(`Unknown region: ${region}`);
  if (cfg.type === "remote" && !cfg.url) {
    throw new Error(`Missing endpoint URL in .env for region: ${region}`);
  }

  const queueName = ttfbQueues[region];

  const workerId = await boss.work(
    queueName,
    {
      includeMetadata: true,
      teamSize: CONCURRENCY,
      teamConcurrency: CONCURRENCY,
      teamRefill: true,
      newJobCheckInterval: 500,
    },
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
        const result =
          cfg.type === "local"
            ? await measureTTFB(targetUrl)
            : await measureRemote(cfg.url, targetUrl,cfg.secret);

        console.log(`[${targetRegion}] TTFB result came`);
        const isSuccess = Boolean(result && result.success);

        const id = parseInt(ttfbdbId, 10);
        if (!Number.isNaN(id)) {
          await prisma.ttfb
            .update({
              where: { id },
              data: {
                status: isSuccess ? "completed" : "failed",
                result,
                error: isSuccess ? null : result?.error || "TTFB measurement failed",
                completedAt: new Date(),
              },
            })
            .catch((err) => {
              if (err.code === "P2025") return null;
              throw err;
            });
        }

        console.log(`[${region}] Job ${job.id} completed successfully`);
        console.log("TTFB RESULT" ,result)

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

        const isLastAttempt = job.retrycount >= job.retrylimit;
        if (isLastAttempt) {
          const id = parseInt(ttfbdbId, 10);
          if (!Number.isNaN(id)) {
            await prisma.ttfb
              .update({
                where: { id },
                data: {
                  status: "failed",
                  error: error.message || "Worker execution failed",
                  completedAt: new Date(),
                },
              })
              .catch(() => {});
          }
        }

        throw error;
      }
    }
  );

  return {
    workerId,
    close: async () => boss.offWork(workerId),
  };
};

export default startTtfbWorker;


// import { measureTTFB } from "../Services/ttfb.Service.js";
// import { prisma } from "../config/db.prismaSQL.js";
// import { boss, ttfbQueues } from "../queue/ttfb.queue.js";

// const CONCURRENCY = Number(process.env.TTFB_WORKER_CONCURRENCY) || 10;
 
// export const startTtfbWorker = async (region) => {
//   const queueName = ttfbQueues[region];
 
//   const workerId = await boss.work(
//     queueName,
//     {
//       includeMetadata: true, // gives job.retrycount / job.retrylimit
//       teamSize: CONCURRENCY, // fetch up to N jobs per poll ...
//       teamConcurrency: CONCURRENCY, // ... run N at once (== BullMQ `concurrency`)
//       teamRefill: true, // refill free slots as soon as a job finishes (don't wait for the slowest)
//       newJobCheckInterval: 500, // ms
//     },
//     async (job) => {
//       console.log(`Processing TTFB job ${job.id} for region: ${region}`);
 
//       const { targetUrl, userId, guestId, roomId, ttfbdbId, region: jobRegion } = job.data;
//       const targetRegion = jobRegion || region;
 
//       if (!targetUrl || !ttfbdbId || (!userId && !guestId) || !roomId) {
//         throw new Error(
//           `Invalid job data. TargetUrl: ${targetUrl}, ttfbdbId: ${ttfbdbId}, actor: ${userId || guestId}`
//         );
//       }
 
//       try {
//         const result = await measureTTFB(targetUrl);
//         console.log(`[${targetRegion}] TTFB result came`);
 
//         const isSuccess = Boolean(result && result.success);
 
//         // Update PostgreSQL record with measurement result
//         const id = parseInt(ttfbdbId, 10);
//         if (!Number.isNaN(id)) {
//           await prisma.ttfb
//             .update({
//               where: { id },
//               data: {
//                 status: isSuccess ? "completed" : "failed",
//                 result,
//                 error: isSuccess ? null : result?.error || "TTFB measurement failed",
//                 completedAt: new Date(),
//               },
//             })
//             .catch((err) => {
//               if (err.code === "P2025") return null;
//               throw err;
//             });
//         }
 
//         console.log(`[${region}] Job ${job.id} completed successfully`);
 
//         // The returned value is stored by pg-boss and delivered to the "completed" listener.
//         return {
//           jobId: job.id,
//           userId,
//           guestId,
//           roomId,
//           ttfbdbId,
//           region: targetRegion,
//           result,
//           status: isSuccess ? "completed" : "failed",
//         };
//       } catch (error) {
//         console.error(`[${targetRegion}] Error processing job ${job.id}:`, error);
 
//         // Only mark the row failed on the LAST attempt; earlier attempts will be retried.
//         const isLastAttempt = job.retrycount >= job.retrylimit;
//         if (isLastAttempt) {
//           const id = parseInt(ttfbdbId, 10);
//           if (!Number.isNaN(id)) {
//             await prisma.ttfb
//               .update({
//                 where: { id },
//                 data: {
//                   status: "failed",
//                   error: error.message || "Worker execution failed",
//                   completedAt: new Date(),
//                 },
//               })
//               .catch(() => {});
//           }
//         }
 
//         throw error; // pg-boss retries (or marks the job failed and emits "failed")
//       }
//     }
//   );
 
//   return {
//     workerId,
//     close: async () => boss.offWork(workerId),
//   };
// };
 
// export default startTtfbWorker;
