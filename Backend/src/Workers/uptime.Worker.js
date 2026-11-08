import { prisma } from "../config/db.prismaSQL.js";
import {
  boss,
  uptimeBatchQueueName,
  uptimeQueueName,
} from "../queue/uptime.queue.js";
import { sendSiteDownEmail } from "../Services/SenddOtp.Service.js";
import {
  runBatch,
  getRunnerById,
  getDefaultRunner,
} from "../Services/runners/index.js";
import { getIntervalMs } from "../Services/uptimeScheduler.Service.js";

const CONCURRENCY = Number(process.env.UPTIME_WORKER_CONCURRENCY) || 5;

// Starvation prevention: limit concurrent executions of slow remote HTTP runners
const REMOTE_CONCURRENCY_LIMIT =
  Number(process.env.UPTIME_REMOTE_RUNNER_MAX_CONCURRENCY) || 2;
let activeRemoteChecks = 0;
const remoteWaitQueue = [];

const acquireRemoteSlot = async () => {
  if (activeRemoteChecks < REMOTE_CONCURRENCY_LIMIT) {
    activeRemoteChecks++;
    return;
  }
  return new Promise((resolve) => remoteWaitQueue.push(resolve));
};

const releaseRemoteSlot = () => {
  activeRemoteChecks = Math.max(0, activeRemoteChecks - 1);
  if (remoteWaitQueue.length > 0) {
    const next = remoteWaitQueue.shift();
    activeRemoteChecks++;
    next();
  }
};

/**
 * Set of HTTP status codes that represent a confirmed downtime incident
 * that warrants dispatching an alert email to the site owner.
 *
 * Specific alertable status codes: 500, 502, 503, 504, 403, 404, 410
 *
 * 500 - Internal Server Error
 * 502 - Bad Gateway
 * 503 - Service Unavailable
 * 504 - Gateway Timeout
 * 403 - Forbidden
 * 404 - Not Found
 * 410 - Gone
 */
export const ALERTABLE_HTTP_STATUS_CODES = Object.freeze(
  new Set([500, 502, 503, 504, 403, 404, 410])
);

/**
 * Returns the active Set of alertable HTTP status codes.
 * Supports environment variable override via UPTIME_ALERT_STATUS_CODES (comma-separated).
 *
 * @returns {Set<number>}
 */
export const getAlertableStatusCodes = () => {
  if (process.env.UPTIME_ALERT_STATUS_CODES) {
    const parsed = process.env.UPTIME_ALERT_STATUS_CODES.split(",")
      .map((c) => parseInt(c.trim(), 10))
      .filter((c) => Number.isInteger(c));
    if (parsed.length > 0) {
      return new Set(parsed);
    }
  }
  return ALERTABLE_HTTP_STATUS_CODES;
};

/**
 * Checks whether a given HTTP status code qualifies for sending a downtime alert email.
 *
 * @param {number|string|null|undefined} statusCode
 * @param {Set<number>} [customSet]
 * @returns {boolean}
 */
export const isAlertableStatusCode = (statusCode, customSet = null) => {
  if (statusCode === null || statusCode === undefined) return false;
  const code = typeof statusCode === "number" ? statusCode : parseInt(statusCode, 10);
  if (!Number.isInteger(code)) return false;
  const targetSet = customSet || getAlertableStatusCodes();
  return targetSet.has(code);
};

export const processResult = async (monitor, result, checkedAt, options = {}) => {
  // Normalize and parse HTTP status code if present
  const rawHttpStatus = result?.httpStatus;
  const parsedHttpStatus =
    rawHttpStatus !== null && rawHttpStatus !== undefined && !Number.isNaN(Number(rawHttpStatus))
      ? Number(rawHttpStatus)
      : null;

  // Resolve alertable status codes set (with support for per-invocation option or env override)
  let alertableSet = null;
  if (options.alertableStatusCodes) {
    alertableSet =
      options.alertableStatusCodes instanceof Set
        ? options.alertableStatusCodes
        : new Set(
            (Array.isArray(options.alertableStatusCodes) ? options.alertableStatusCodes : [])
              .map(Number)
              .filter(Number.isInteger)
          );
  } else {
    alertableSet = getAlertableStatusCodes();
  }

  const hasAlertableStatusCode = isAlertableStatusCode(parsedHttpStatus, alertableSet);

  // Determine if the site is DOWN (explicit status is DOWN, or HTTP status >= 400 without explicit UP)
  const isDown =
    !result ||
    result.status === "DOWN" ||
    (parsedHttpStatus !== null &&
      parsedHttpStatus >= 400 &&
      result.status !== "UP");
  const isUp = !isDown;

  // Determine if this downtime event is eligible for dispatching an email alert.
  // By requirement: send email ONLY when receiving status code 500, 502, 503, 504, 403, 404, 410.
  // When parsedHttpStatus is null (e.g. TIMEOUT, DNS_ERROR, CONNECTION_REFUSED), dispatch alerts
  // unless explicitly disabled via options.alertOnNetworkErrors === false or UPTIME_ALERT_ON_STATUS_ONLY=true.
  const alertOnStatusOnly = Boolean(
    options.alertOnStatusOnly ?? (process.env.UPTIME_ALERT_ON_STATUS_ONLY === "true")
  );
  const isAlertableDowntime = alertOnStatusOnly
    ? hasAlertableStatusCode
    : hasAlertableStatusCode ||
      (parsedHttpStatus === null && isDown && options.alertOnNetworkErrors !== false);

  let alertSent = false;
  let alertError = null;

  if (isDown) {
    const userEmail = monitor.user?.email || options.userEmail;
    const userName = monitor.user?.name || "User";

    if (!isAlertableDowntime) {
      console.log(
        `[Uptime Worker] Site ${monitor.url} is DOWN (HTTP: ${parsedHttpStatus ?? "N/A"}, Reason: ${
          result?.reason || "N/A"
        }), but HTTP status code is not in alertable list ([${Array.from(alertableSet).join(
          ", "
        )}]). Skipping alert email to ${userEmail || "user"}.`
      );
    } else {
      // Alert deduplication / cooldown:
      const previousResult = monitor.lastResult;
      const wasPreviouslyDown = Boolean(
        previousResult &&
          (previousResult.status === "DOWN" || previousResult.status === "down")
      );
      const lastAlertSentAt = previousResult?.lastAlertSentAt
        ? new Date(previousResult.lastAlertSentAt).getTime()
        : 0;

      // Cooldown between repeated DOWN notifications (default 30 mins)
      const ALERT_COOLDOWN_MS =
        Number(process.env.UPTIME_ALERT_COOLDOWN_MS) || 30 * 60 * 1000;
      const isThrottleDisabled = process.env.UPTIME_ALERT_THROTTLE === "false";
      const shouldSendAlert =
        isThrottleDisabled ||
        !wasPreviouslyDown ||
        Date.now() - lastAlertSentAt >= ALERT_COOLDOWN_MS ||
        Boolean(options.forceAlert);

      if (userEmail && shouldSendAlert) {
        console.log(
          `[Uptime Worker] Site ${monitor.url} is DOWN (Reason: ${result?.reason || "ERROR"}, HTTP: ${
            parsedHttpStatus ?? "N/A"
          }). Dispatching alert email to ${userEmail}...`
        );
        try {
          const mailSender =
            typeof options.sendEmail === "function" ? options.sendEmail : sendSiteDownEmail;
          const emailRes = await mailSender({
            to: userEmail,
            userName,
            url: monitor.url,
            monitorId: monitor.id,
            result,
            checkedAt,
            hostinginfo: monitor.hostinginfo,
          });

          if (emailRes?.success) {
            alertSent = true;
            console.log(
              `[Uptime Worker] Alert email dispatched successfully to ${userEmail} for monitor ${monitor.id}`
            );
          } else if (emailRes?.skipped) {
            console.warn(
              `[Uptime Worker] Alert email skipped for ${userEmail}: ${emailRes.error}`
            );
          } else {
            alertError = emailRes?.error || "Unknown email failure";
            console.error(
              `[Uptime Worker] Failed to send alert email to ${userEmail}:`,
              alertError
            );
          }
        } catch (mailErr) {
          alertError = mailErr.message;
          console.error(
            `[Uptime Worker] Exception sending alert email to ${userEmail}:`,
            mailErr.message
          );
        }
      } else if (userEmail && wasPreviouslyDown && !shouldSendAlert) {
        console.log(
          `[Uptime Worker] Site ${monitor.url} is still DOWN. Alert email throttled (last alert sent at ${new Date(
            lastAlertSentAt
          ).toISOString()}).`
        );
      } else if (!userEmail) {
        console.warn(
          `[Uptime Worker] No user email found for monitor ${monitor.id} (userId: ${monitor.userId}). Cannot send alert email.`
        );
      }
    }
  }

  // Build metadata to persist in uptimeMonitor.lastResult
  const lastResultData = {
    ...result,
    alertSent,
    lastAlertSentAt: alertSent
      ? checkedAt.toISOString()
      : isDown && monitor.lastResult?.lastAlertSentAt
      ? monitor.lastResult.lastAlertSentAt
      : null,
  };

  return {
    monitorId: monitor.id,
    userId: monitor.userId,
    interval: monitor.interval,
    result,
    lastResultData,
    status: isUp ? "up" : "down",
    alertSent,
    alertError: alertError || undefined,
  };
};

/**
 * Handles execution of a batch check job.
 *
 * @param {object} job - pg-boss job object
 * @returns {Promise<{ runnerName: string, items: Array<object> }>}
 */
export const handleBatchJob = async (job) => {
  const { monitorIds, runnerId } = job.data || {};
  const rawIds =
    monitorIds ||
    (job.data?.monitorId != null ? [job.data.monitorId] : []);

  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    console.warn(`[Uptime Worker] Job ${job.id} contained no monitor IDs. Skipping.`);
    return { runnerName: "none", items: [] };
  }

  const parsedIds = rawIds
    .map((id) => (typeof id === "number" ? id : parseInt(id, 10)))
    .filter((id) => !Number.isNaN(id));

  if (parsedIds.length === 0) {
    console.warn(`[Uptime Worker] Job ${job.id} contained only invalid monitor IDs.`);
    return { runnerName: "none", items: [] };
  }

  // Resolve the assigned runner or fallback to system default runner
  let resolvedRunner = null;
  if (runnerId !== undefined && runnerId !== null) {
    resolvedRunner = await getRunnerById(runnerId);
    if (!resolvedRunner || !resolvedRunner.isActive) {
      console.warn(
        `[Uptime Worker] Job ${job.id}: Runner ID ${runnerId} is ${
          !resolvedRunner ? "missing/deleted" : "inactive/disabled"
        }. Falling back to system default runner.`
      );
      resolvedRunner = await getDefaultRunner();
    }
  } else {
    // Old queued jobs or default monitor batches use system default runner
    resolvedRunner = await getDefaultRunner();
  }

  // 1. Load active monitors (skip paused/deleted)
  const monitors = await prisma.uptimeMonitor.findMany({
    where: {
      id: { in: parsedIds },
      status: "active",
    },
    select: {
      id: true,
      userId: true,
      url: true,
      interval: true,
      status: true,
      hostinginfo: true,
      lastResult: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  if (!monitors || monitors.length === 0) {
    console.log(
      `[Uptime Worker] Job ${job.id}: none of the ${parsedIds.length} monitors are active. Skipping.`
    );
    return { runnerName: "none", items: [] };
  }

  const checkedAt = new Date();

  // 2. Dispatch batch check to the resolved runner (with remote concurrency isolation)
  const isRemote = resolvedRunner?.type === "http";
  if (isRemote) {
    await acquireRemoteSlot();
  }

  let runnerName = "none";
  let results = [];
  try {
    const batchPayload = monitors.map((m) => ({ id: m.id, url: m.url }));
    const batchRun = await runBatch(batchPayload, resolvedRunner);
    runnerName = batchRun.runnerName;
    results = batchRun.results;
  } finally {
    if (isRemote) {
      releaseRemoteSlot();
    }
  }

  const resultMap = new Map();
  if (Array.isArray(results)) {
    for (const r of results) {
      if (r && r.monitorId != null) {
        resultMap.set(Number(r.monitorId), r.result);
      }
    }
  }

  // 3. Process each monitor result
  const processedList = [];
  for (const monitor of monitors) {
    const rawResult = resultMap.get(monitor.id);
    const isMissingFromRunner = !rawResult;

    let checkResult;
    if (isMissingFromRunner) {
      console.warn(
        `[Uptime Worker] Monitor ${monitor.id} (${monitor.url}) missing from runner response (${runnerName}). Treating as failed check; lease preserved for retry.`
      );
      checkResult = {
        status: "DOWN",
        reason: "ERROR",
        error: "Check execution incomplete or missing response",
      };
    } else {
      checkResult = {
        ...rawResult,
      };
    }

    const processed = await processResult(monitor, checkResult, checkedAt, {
      forceAlert: Boolean(job.data?.forceAlert),
    });

    processedList.push({
      ...processed,
      url: monitor.url,
      hostinginfo: monitor.hostinginfo,
      isMissingFromRunner,
    });
  }

  // 4. Persist in a single $transaction:
  // - Skip storing results whose reason === "ABORTED"
  // - uptimeResult.createMany (persists runnerName in ADMIN-ONLY column)
  // - per-monitor update of lastResult, lastCheckedAt, nextCheckAt
  const resultsToInsert = [];
  const monitorUpdates = [];

  for (const item of processedList) {
    if (item.result?.reason === "ABORTED") {
      console.log(
        `[Uptime Worker] Skipping storage for aborted check on monitor ${item.monitorId}`
      );
      continue;
    }

    resultsToInsert.push({
      monitorId: item.monitorId,
      userId: item.userId,
      result: item.result,
      runnerName, // ADMIN-ONLY column for debugging & latency comparison
      checkedAt,
    });

    const intervalMs = getIntervalMs(item.interval);
    const updateData = {
      lastResult: item.lastResultData,
      lastCheckedAt: checkedAt,
    };

    // If monitor was missing from runner, do NOT advance nextCheckAt; 150s lease retries it
    if (!item.isMissingFromRunner) {
      updateData.nextCheckAt = new Date(checkedAt.getTime() + intervalMs);
    }

    monitorUpdates.push(
      prisma.uptimeMonitor.update({
        where: { id: item.monitorId },
        data: updateData,
      })
    );
  }

  const txOps = [];
  if (resultsToInsert.length > 0) {
    txOps.push(
      prisma.uptimeResult.createMany({
        data: resultsToInsert,
      })
    );
  }
  txOps.push(...monitorUpdates);

  if (txOps.length > 0) {
    await prisma.$transaction(txOps);
  }

  // 5. Construct socket item payloads for queue completion events (omits runner details)
  const socketItems = processedList
    .filter((item) => item.result?.reason !== "ABORTED")
    .map((item) => ({
      jobId: job.id,
      monitorId: item.monitorId.toString(),
      userId: item.userId.toString(),
      roomId: `user:${item.userId}`,
      url: item.url,
      result: item.result,
      status: item.status,
      hostinginfo: item.hostinginfo || null,
      alertSent: item.alertSent,
      alertError: item.alertError,
    }));

  console.log(
    `[Uptime Worker] Batch job ${job.id} completed via runner '${runnerName}' (${socketItems.length} monitor(s) processed)`
  );

  return {
    runnerName,
    items: socketItems,
  };
};

/**
 * Starts the pg-boss batch worker.
 * Listens on uptimeBatchQueueName (and drains legacy uptimeQueueName).
 */
export const startUptimeWorker = async () => {
  const workerOptions = {
    includeMetadata: true,
    teamSize: CONCURRENCY,
    teamConcurrency: CONCURRENCY,
    teamRefill: true,
    newJobCheckInterval: 500,
  };

  // Primary batch queue worker
  const batchWorkerId = await boss.work(
    uptimeBatchQueueName,
    workerOptions,
    handleBatchJob
  );

  // Backward compatibility: drain any legacy individual jobs on old queue
  const legacyWorkerId = await boss.work(
    uptimeQueueName,
    workerOptions,
    handleBatchJob
  );

  console.log(
    `[Uptime Worker] Batch worker active on '${uptimeBatchQueueName}' (and legacy '${uptimeQueueName}') with concurrency ${CONCURRENCY}.`
  );

  return {
    batchWorkerId,
    legacyWorkerId,
    close: async () => {
      await Promise.allSettled([
        boss.offWork(batchWorkerId),
        boss.offWork(legacyWorkerId),
      ]);
    },
  };
};

export default startUptimeWorker;
