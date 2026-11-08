import { europeTtfbQueueEvent, indiaTtfbQueueEvent, usaTtfbQueueEvent } from "../../queue/ttfb.QeventListner.js";
//import { europeTtfbQueue, indiaTtfbQueue, usaTtfbQueue } from "../../queue/ttfb.queue.js";
import { prisma } from "../../config/db.prismaSQL.js";



export const setupTtfbQueueResult = (io) => {
  handleQueueEvent(indiaTtfbQueueEvent, "india", io);
  handleQueueEvent(europeTtfbQueueEvent, "canada", io);
  handleQueueEvent(usaTtfbQueueEvent, "singapore", io);
};
 
export const handleQueueEvent = (queueEvent, region, io) => {
  // Error handler to avoid unhandled EventEmitter exceptions
  queueEvent.on("error", (err) => {
    console.error(`[TTFB ${region}] QueueEvents error:`, err);
  });
 
  // Completed job event - result comes straight from the worker's return value
  queueEvent.on("completed", async ({ jobId, returnvalue }) => {
    try {
      let data = typeof returnvalue === "string" ? JSON.parse(returnvalue) : returnvalue;
 
      if (!data) {
        console.warn(`[TTFB ${region}] No returnvalue data found for job ${jobId}`);
        return;
      }
 
      const roomId = data.roomId;
      if (!roomId) {
        console.warn(`[TTFB ${region}] No roomId present in job ${jobId} returnvalue`);
        return;
      }
 
      const payload = {
        jobId,
        ttfbdbId: data.ttfbdbId,
        roomId,
        region: data.region || region,
        result: data.result,
        status: data.status || "completed",
      };
 
      const sockets = await io.in(roomId).fetchSockets();
      if (!sockets || sockets.length === 0) {
        console.warn(`[TTFB ${region}] Room ${roomId} has 0 connected sockets. Result is persisted in DB for job ${jobId}.`);
      }
 
      // Emit standard and legacy events
      io.to(roomId).emit("ttfb:result", payload);
      io.to(roomId).emit("ttfbCompleted", payload);
    } catch (err) {
      console.error(`[TTFB ${region}] Error processing completed event for job ${jobId}:`, err);
    }
  });
 
  // Failed job event - fires once, after retries are used up (or the job expired).
  // The DB id now comes from the original job data (job ids are UUIDs in pg-boss).
  queueEvent.on("failed", async ({ jobId, failedReason, data }) => {
    console.error(`[TTFB ${region}] Job ${jobId} failed:`, failedReason);
 
    try {
      const ttfbId = parseInt(data?.ttfbdbId, 10);
      if (Number.isNaN(ttfbId)) return;
 
      // Only touches rows that are not already completed/failed (never overwrites a result)
      await prisma.ttfb.updateMany({
        where: { id: ttfbId, status: { notIn: ["completed", "failed"] } },
        data: {
          status: "failed",
          error: failedReason || "TTFB measurement failed",
          completedAt: new Date(),
        },
      });
 
      const ttfbDoc = await prisma.ttfb.findUnique({ where: { id: ttfbId } });
 
      if (ttfbDoc?.roomId) {
        const error = ttfbDoc.error || failedReason || "TTFB measurement failed";
        const failPayload = {
          jobId,
          ttfbdbId: ttfbDoc.id.toString(),
          roomId: ttfbDoc.roomId,
          region: ttfbDoc.region || region,
          result: {
            region: ttfbDoc.region || region,
            status: "failed",
            error,
          },
          error,
          status: "failed",
        };
 
        const sockets = await io.in(ttfbDoc.roomId).fetchSockets();
        if (!sockets || sockets.length === 0) {
          console.warn(`[TTFB ${region}] Room ${ttfbDoc.roomId} has 0 connected sockets on fail for job ${jobId}.`);
        }
 
        io.to(ttfbDoc.roomId).emit("ttfb:result", failPayload);
        io.to(ttfbDoc.roomId).emit("ttfbCompleted", failPayload);
      }
    } catch (err) {
      console.error(`[TTFB ${region}] Error processing failed event for job ${jobId}:`, err);
    }
  });
 
  // Start consuming only after the listeners above are attached
  queueEvent.start().catch((err) => {
    console.error(`[TTFB ${region}] Failed to start completion listener:`, err);
  });
};
 





// const queueMap = {
//   india: indiaTtfbQueue,
//   europe: europeTtfbQueue,
//   usa: usaTtfbQueue,
// };
// Handling BullMQ queue events when jobs complete or fail
// export const setupTtfbQueueResult = (io) => {
//   handleQueueEvent(indiaTtfbQueueEvent, "india", io);
//   handleQueueEvent(europeTtfbQueueEvent, "europe", io);
//   handleQueueEvent(usaTtfbQueueEvent, "usa", io);
// };

// export const handleQueueEvent = (queueEvent, region, io) => {
//   // Connection / stream error handler to avoid unhandled EventEmitter exceptions
//   queueEvent.on("error", (err) => {
//     console.error(`[TTFB ${region}] QueueEvents error:`, err);
//   });

//   // Completed job event - extract directly from worker returnvalue (no Redis getJob call needed)
//   queueEvent.on("completed", async ({ jobId, returnvalue, returnValue }) => {
//     try {
//       let raw = returnvalue || returnValue;
//       let data = typeof raw === "string" ? JSON.parse(raw) : raw;

//       if (!data) {
//         console.warn(`[TTFB ${region}] No returnvalue data found for job ${jobId}`);
//         return;
//       }

//       const roomId = data.roomId;
//       if (!roomId) {
//         console.warn(`[TTFB ${region}] No roomId present in job ${jobId} returnvalue`);
//         return;
//       }

//       const payload = {
//         jobId,
//         ttfbdbId: data.ttfbdbId ,
//         roomId,
//         region: data.region || region,
//         result: data.result,
//         status: data.status || "completed",
//       }; 
//       console.log("from ttfb queue result ", data)

//       const sockets = await io.in(roomId).fetchSockets();
//       if (!sockets || sockets.length === 0) {
//         console.warn(`[TTFB ${region}] Room ${roomId} has 0 connected sockets. Result is persisted in DB for job ${jobId}.`);
//       } else {
//         console.log(`[TTFB ${region}] Result emitted to ${sockets.length} socket(s) in room ${roomId} for job ${jobId}`);
//       }

//       // Emit standard and legacy events
//       io.to(roomId).emit("ttfb:result", payload);
//       io.to(roomId).emit("ttfbCompleted", payload);
//     } catch (err) {
//       console.error(`[TTFB ${region}] Error processing completed event for job ${jobId}:`, err);
//     }
//   });

//   // Failed job event - extracts DB id from jobId (e.g. "ttfb-123" -> 123) with queue data fallback
//   queueEvent.on("failed", async ({ jobId, failedReason }) => {
//     console.error(`[TTFB ${region}] Job ${jobId} failed:`, failedReason);

//     try {
//       // 1. Extract DB id from jobId pattern (e.g. "ttfb-123" or "123")
//       let ttfbId = null;
//       if (typeof jobId === "string") {
//         const match = jobId.match(/\d+$/);
//         if (match) {
//           ttfbId = parseInt(match[0], 10);
//         }
//       } else if (typeof jobId === "number") {
//         ttfbId = jobId;
//       }

//       // 2. Fallback: get job data from queue if ID could not be extracted directly
//       if (!ttfbId || Number.isNaN(ttfbId)) {
//         const q = queueMap[region];
//         if (q) {
//           try {
//             const job = await q.getJob(jobId);
//             if (job?.data?.ttfbdbId) {
//               ttfbId = parseInt(job.data.ttfbdbId, 10);
//             }
//           } catch (qErr) {
//             console.warn(`[TTFB ${region}] Failed to get job ${jobId} from queue:`, qErr.message);
//           }
//         }
//       }

//       const ttfbDoc = ttfbId && !Number.isNaN(ttfbId)
//         ? await prisma.ttfb.update({
//             where: { id: ttfbId },
//             data: {
//               status: "failed",
//               error: failedReason || "TTFB measurement failed",
//               completedAt: new Date(),
//             },
//           }).catch((err) => {
//             if (err.code === "P2025") return null;
//             throw err;
//           })
//         : null;

//       if (ttfbDoc?.roomId) {
//         const failPayload = {
//           jobId,
//           ttfbdbId: ttfbDoc.id.toString(),
//           roomId: ttfbDoc.roomId,
//           region: ttfbDoc.region || region,
//           result: {
//             region: ttfbDoc.region || region,
//             status: "failed",
//             error: failedReason || "TTFB measurement failed",
//           },
//           error: failedReason || "TTFB measurement failed",
//           status: "failed",
//         };

//         const sockets = await io.in(ttfbDoc.roomId).fetchSockets();
//         if (!sockets || sockets.length === 0) {
//           console.warn(`[TTFB ${region}] Room ${ttfbDoc.roomId} has 0 connected sockets on fail for job ${jobId}.`);
//         }

//         io.to(ttfbDoc.roomId).emit("ttfb:result", failPayload);
//         io.to(ttfbDoc.roomId).emit("ttfbCompleted", failPayload);
//       }
//     } catch (err) {
//       console.error(`[TTFB ${region}] Error processing failed event for job ${jobId}:`, err);
//     }
//   });
// };
