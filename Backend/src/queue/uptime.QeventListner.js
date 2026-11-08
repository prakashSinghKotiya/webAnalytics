import { EventEmitter } from "events";
import { boss, uptimeBatchQueueName, uptimeQueueName } from "./uptime.queue.js";

/**
 * Normalizes an item or payload ensuring any BigInt or number IDs are converted to strings.
 */
const sanitizePayload = (item, jobId) => {
  if (!item || typeof item !== "object") return item;
  return {
    ...item,
    jobId: item.jobId || jobId,
    monitorId: item.monitorId != null ? item.monitorId.toString() : undefined,
    userId: item.userId != null ? item.userId.toString() : undefined,
  };
};

class UptimeQueueEvents extends EventEmitter {
  constructor(queueName = uptimeBatchQueueName) {
    super();
    this.queueName = queueName;
    this.started = false;
  }

  // Call AFTER attaching listeners (UptimeRobotEventResult does this)
  async start() {
    if (this.started) return;
    this.started = true;

    const listenerHandler = async (job) => {
      const { request, response, failed, state } = job.data;
      const jobId = request?.id;

      try {
        if (failed) {
          const failedReason =
            response?.message ||
            response?.value ||
            (state === "expired"
              ? "Job expired before it finished"
              : "Uptime check batch failed");

          const rawIds =
            request?.data?.monitorIds ||
            (request?.data?.monitorId != null ? [request.data.monitorId] : []);

          if (Array.isArray(rawIds) && rawIds.length > 0) {
            for (const mId of rawIds) {
              this.emit("failed", {
                jobId,
                data: {
                  ...request?.data,
                  monitorId: mId?.toString(),
                },
                failedReason,
              });
            }
          } else {
            this.emit("failed", {
              jobId,
              data: request?.data,
              failedReason,
            });
          }
        } else {
          // Success: if response contains items array, emit one completed event per monitor
          if (response?.items && Array.isArray(response.items)) {
            for (const item of response.items) {
              const sanitized = sanitizePayload(item, jobId);
              this.emit("completed", {
                jobId,
                returnvalue: sanitized,
                returnValue: sanitized,
              });
            }
          } else if (response) {
            // Single-item fallback (e.g. legacy individual check)
            const sanitized = sanitizePayload(response, jobId);
            this.emit("completed", {
              jobId,
              returnvalue: sanitized,
              returnValue: sanitized,
            });
          }
        }
      } catch (err) {
        console.error(`[${this.queueName}] completion listener error:`, err);
      }
    };

    const workerOptions = {
      teamSize: 10,
      teamConcurrency: 10,
      teamRefill: true,
      newJobCheckInterval: 500,
    };

    // Primary: listen on batch queue
    await boss.onComplete(this.queueName, workerOptions, listenerHandler);

    // Legacy fallback: also listen on old single-monitor queue if distinct
    if (this.queueName !== uptimeQueueName) {
      await boss
        .onComplete(uptimeQueueName, workerOptions, listenerHandler)
        .catch((err) => {
          console.warn(
            `[Uptime QueueEvents] Note: legacy queue listener failed: ${err.message}`
          );
        });
    }
  }
}

export const indiaUptimeRobotEvent = new UptimeQueueEvents(uptimeBatchQueueName);
export const uptimeQueueEvents = indiaUptimeRobotEvent;
export const uptimeQueueListener = indiaUptimeRobotEvent;
export default indiaUptimeRobotEvent;
