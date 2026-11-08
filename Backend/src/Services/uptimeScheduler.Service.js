import { prisma } from "../config/db.prismaSQL.js";
import {
  boss,
  uptimeBatchQueueName,
  uptimeDispatcherQueueName,
  uptimeQueueName,
  enqueueUptimeBatch,
} from "../queue/uptime.queue.js";
import { getRunnerById, getDefaultRunner } from "./runners/index.js";

export { enqueueUptimeBatch };

const INTERVALS = {
  "1m": 60 * 1000,
  "m1": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "m5": 5 * 60 * 1000,
  "10m": 10 * 60 * 1000,
  "m10": 10 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "m15": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "m30": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "h1": 60 * 60 * 1000,
};

export const getIntervalMs = (interval) => {
  return INTERVALS[interval] || 5 * 60 * 1000;
};

/**
 * Splits an array of items into chunks of up to chunkSize.
 *
 * @template T
 * @param {Array<T>} array - Array to chunk
 * @param {number} [chunkSize=50] - Maximum size of each chunk
 * @returns {Array<Array<T>>} Array of chunked arrays
 */
export const chunkArray = (array, chunkSize = 50) => {
  if (!Array.isArray(array) || array.length === 0) return [];
  const size = Math.max(1, Number(chunkSize) || 50);
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

/**
 * Scans PostgreSQL atomically for due active monitors using FOR UPDATE SKIP LOCKED,
 * extends their nextCheckAt by a 150-second lease, groups them by runnerId (null = default),
 * chunks each group by the runner's configured batchSize (or UPTIME_BATCH_SIZE / 50),
 * and enqueues one job per chunk via enqueueUptimeBatch(chunk, runnerId).
 *
 * @returns {Promise<number>} Number of due monitors acquired and dispatched
 */
export const dispatchDueMonitors = async () => {
  try {
    const rawSql = `
      UPDATE "UptimeMonitor"
      SET "nextCheckAt" = (NOW() AT TIME ZONE 'UTC') + INTERVAL '150 seconds'
      WHERE id IN (
        SELECT id
        FROM "UptimeMonitor"
        WHERE status = 'active'
          AND "nextCheckAt" <= (NOW() AT TIME ZONE 'UTC')
        ORDER BY "nextCheckAt" ASC
        LIMIT 1000
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "runnerId";
    `;

    const acquired = await prisma.$queryRawUnsafe(rawSql);

    if (!acquired || acquired.length === 0) {
      return 0;
    }

    const defaultBatchSize = Math.max(1, Number(process.env.UPTIME_BATCH_SIZE) || 50);

    // Group acquired monitors by runnerId (null indicates default runner)
    const groups = new Map();
    for (const item of acquired) {
      const rId =
        item.runnerId !== undefined && item.runnerId !== null ? Number(item.runnerId) : null;
      if (!groups.has(rId)) {
        groups.set(rId, []);
      }
      groups.get(rId).push(item.id);
    }

    // Resolve per-runner batch size from runner.config.batchSize and chunk each runner group
    const chunksToDispatch = [];
    for (const [rId, ids] of groups.entries()) {
      let runnerBatchSize = defaultBatchSize;
      try {
        const runner = rId !== null ? await getRunnerById(rId) : await getDefaultRunner();
        if (runner?.config?.batchSize) {
          const customBatchSize = Number(runner.config.batchSize);
          if (Number.isFinite(customBatchSize) && customBatchSize > 0) {
            runnerBatchSize = Math.floor(customBatchSize);
          }
        }
      } catch (err) {
        // Fall back to default batch size if runner lookup fails
      }

      const chunks = chunkArray(ids, runnerBatchSize);
      for (const chunk of chunks) {
        chunksToDispatch.push({ chunk, runnerId: rId });
      }
    }

    console.log(
      `[Uptime Scheduler] Acquired ${acquired.length} due monitor(s), dispatching across ${chunksToDispatch.length} batch(es) for ${groups.size} runner(s)...`
    );

    await Promise.allSettled(
      chunksToDispatch.map(({ chunk, runnerId }) =>
        enqueueUptimeBatch(chunk, runnerId)
      )
    );

    return acquired.length;
  } catch (err) {
    console.error("[Uptime Scheduler] Error dispatching due monitors:", err);
    return 0;
  }
};

/**
 * Ensures the 1-minute recurring dispatcher schedule exists in pg-boss.
 */
export const initUptimeScheduler = async () => {
  try {
    const schedules = await boss.getSchedules().catch(() => []);
    const exists = schedules.some((s) => s.name === uptimeDispatcherQueueName);
    if (!exists) {
      await boss.schedule(uptimeDispatcherQueueName, "* * * * *", {});
      console.log(`[Uptime Scheduler] Registered pg-boss recurring schedule for '${uptimeDispatcherQueueName}'.`);
    }
  } catch (err) {
    console.error("[Uptime Scheduler] Failed to register schedule in pg-boss:", err);
  }
};

/**
 * Starts the dispatcher worker that listens to the 1-minute tick from pg-boss.
 */
export const startUptimeScheduler = async () => {
  await initUptimeScheduler();

  const workerId = await boss.work(
    uptimeDispatcherQueueName,
    { teamSize: 1, teamConcurrency: 1, newJobCheckInterval: 1000 },
    async () => {
      await dispatchDueMonitors();
    }
  );

  console.log("[Uptime Scheduler] Dispatcher worker active and listening for cron ticks.");

  // Run an immediate sweep on boot to catch any due monitors without waiting for next minute
  dispatchDueMonitors().catch((err) => {
    console.error("[Uptime Scheduler] Initial sweep error:", err);
  });

  return {
    workerId,
    close: async () => boss.offWork(workerId),
  };
};

/**
 * Enqueues an immediate probe check for a newly created or resumed monitor.
 * Leases the monitor for 150 seconds and enqueues a 1-monitor batch job.
 */
export const createUptimeScheduler = async (monitor, roomId) => {
  const rawId = monitor.id ?? monitor._id;
  const parsedId = typeof rawId === "number" ? rawId : parseInt(rawId, 10);
  const monitorId = parsedId?.toString();
  const schedulerId = `uptime-monitor:${monitorId}`;
  const rawUserId = monitor.userId ?? monitor.user?.id ?? monitor.user?._id;
  const userId = rawUserId?.toString();
  const targetRoomId = roomId || (userId ? `user:${userId}` : null);

  if (!Number.isNaN(parsedId)) {
    // Extend lease by 150s so concurrent background dispatcher does not re-dispatch
    await prisma.uptimeMonitor
      .update({
        where: { id: parsedId },
        data: {
          nextCheckAt: new Date(Date.now() + 150_000),
        },
      })
      .catch(() => null);
  }

  // Send an immediate 1-monitor batch job so results arrive right away
  const jobId = await boss.send(
    uptimeBatchQueueName,
    {
      monitorIds: [parsedId],
    },
    {
      retryLimit: 1,
      retryDelay: 5,
      expireInSeconds: 120,
    }
  );

  return {
    schedulerId,
    jobId,
    roomId: targetRoomId,
  };
};

export const updateUptimeScheduler = async (monitor, roomId) => {
  return createUptimeScheduler(monitor, roomId);
};

export const removeUptimeScheduler = async (monitorId, roomId) => {
  const schedulerId = `uptime-monitor:${monitorId}`;
  return {
    schedulerId,
    monitorId: monitorId?.toString(),
    roomId,
  };
};

export default {
  startUptimeScheduler,
  createUptimeScheduler,
  updateUptimeScheduler,
  removeUptimeScheduler,
  dispatchDueMonitors,
  getIntervalMs,
};
