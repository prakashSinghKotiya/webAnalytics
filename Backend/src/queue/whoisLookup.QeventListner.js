import { EventEmitter } from "events";
import { boss, whoisLookupQueue } from "./WhoisLookup.Queue.js";

class WhoisQueueEvents extends EventEmitter {
  constructor(queueName) {
    super();
    this.queueName = queueName;
    this.started = false;
  }

  // Call AFTER attaching listeners (handleWhoisQueueEvent does this)
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

export const whoisLookupListener = new WhoisQueueEvents(whoisLookupQueue);
export default whoisLookupListener;

//bullmq
// import { QueueEvents } from "bullmq";
// import { queueEventsConn2 } from "../config/redis.js";
// export const whoisLookupListener = new QueueEvents("whoisLookup-queue", {
//   connection: queueEventsConn2
// });
