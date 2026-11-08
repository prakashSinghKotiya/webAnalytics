import { EventEmitter } from "events";
import { boss, dnsRecordQueueName } from "./dnsRecordCheck.Queue.js";

class DnsQueueEvents extends EventEmitter {
  constructor(queueName) {
    super();
    this.queueName = queueName;
    this.started = false;
  }

  // Call AFTER attaching listeners (handleDnsQueueEvent does this)
  async start() {
    if (this.started) return;
    this.started = true;

    await boss.onComplete(
      this.queueName,
      { teamSize: 10, teamConcurrency: 10, teamRefill: true, newJobCheckInterval: 500 },
      async (job) => {
        const { request, response, failed, state } = job.data;
        try {
          if (failed) {
            this.emit("failed", {
              jobId: request?.id,
              data: request?.data,
              failedReason:
                response?.message ||
                response?.value ||
                (state === "expired" ? "Job expired before it finished" : undefined),
            });
          } else {
            this.emit("completed", { jobId: request?.id, returnvalue: response });
          }
        } catch (err) {
          console.error(`[${this.queueName}] completion listener error:`, err);
        }
      }
    );
  }
}

export const dnsRecordCheckListener = new DnsQueueEvents(dnsRecordQueueName);
export const dnsRecordQueueEvents = dnsRecordCheckListener;
export default dnsRecordCheckListener;

// BullMQ reference (migrated to pg-boss)
// import { QueueEvents } from "bullmq";
// import { queueEventsConn2 } from "../config/redis.js";
// export const dnsRecordCheckListener = new QueueEvents("dnsRecordCheck-queue", {
//   connection: queueEventsConn2
// });
