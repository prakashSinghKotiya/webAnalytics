// import { QueueEvents } from "bullmq";
// import {  queueEventsConn2 } from "../config/redis.js";


import { EventEmitter } from "events";
import { boss, ttfbQueues } from "./ttfb.queue.js";




class TtfbQueueEvents extends EventEmitter {
  constructor(queueName) {
    super();
    this.queueName = queueName;
    this.started = false;
  }
 
  // Call AFTER attaching listeners (handleQueueEvent does this).
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
 
export const indiaTtfbQueueEvent = new TtfbQueueEvents(ttfbQueues.india);
export const europeTtfbQueueEvent = new TtfbQueueEvents(ttfbQueues.canada);
export const usaTtfbQueueEvent = new TtfbQueueEvents(ttfbQueues.singapore);













//bullmq
// export const indiaTtfbQueueEvent = new QueueEvents("ttfb-india", {
//     connection: queueEventsConn2
// });

// export const europeTtfbQueueEvent = new QueueEvents("ttfb-europe", {
//     connection: queueEventsConn2
// });

// export const usaTtfbQueueEvent = new QueueEvents("ttfb-usa", {
//     connection: queueEventsConn2
// });
