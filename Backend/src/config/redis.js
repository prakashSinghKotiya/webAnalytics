// /**
//  * DEPRECATED: Redis has been completely removed from this application.
//  * Background jobs and queues are now handled by pg-boss on PostgreSQL.
//  * Guest demo usage tracking and rate limiting are handled directly via Prisma and PostgreSQL transactions.
//  * 
//  * This file is retained as a safe no-op stub to prevent runtime errors
//  * if any legacy or external module attempts to import it.
//  */

// export const redisConnectionOptions = {};
// export const sharedRedisConnection = null;
// export const sharedWorkerRedisConnection = null;
// export const queueEventsConn1 = null;
// export const queueEventsConn2 = null;
// export const connection = null;
// export const closeRedisConnection = async () => {};

// export default null;



//uptime quueue using bullmq :import { Queue } from "bullmq";
// import { sharedRedisConnection } from "../config/redis.js";

// const defaultJobOptions = {
//   attempts: 3, //if job fails, it will be retried 3 times
//   backoff: {
//     type: "exponential",
//     delay: 1000, // after every retry delay will be doubled (1s, 2s, 4s)
//   },
//   removeOnComplete: { age: 600, count: 2000 }, 
//   removeOnFail: { age: 1800, count: 2000 },
// };

// export const uptimeMonitorQueue = new Queue("uptimeRobot-india", {
//     connection: sharedRedisConnection,
//     defaultJobOptions,
// });

// // await uptimeMonitorQueue.obliterate({ force: true });
// // console.log("Uptime queue cleared");



// const attachQueueErrorHandler = (queue, region) => {  //error handler for queue errors
//     queue.on("error", (err) => {
//         console.error(`[${region}] Queue Error:`, err);
//     });
// };

// attachQueueErrorHandler(uptimeMonitorQueue, "india");






// uptime schedduler using bullmq : 

// import { uptimeMonitorQueue } from "../queue/uptime.queue.js";

// const INTERVALS = {
//     "1m": 60 * 1000,
//     "5m": 5 * 60 * 1000,
//     "10m": 10 * 60 * 1000,
//     "30m": 30 * 60 * 1000,
//     "1h": 60 * 60 * 1000
// };


// const getInterval = (interval) => {

//     const milliseconds = INTERVALS[interval];

//     if (!milliseconds) {
//         throw new Error(`Invalid interval: ${interval}`);
//     }

//     return milliseconds;
// };


// export const createUptimeScheduler = async (monitor,roomId) => {

//     const every = getInterval(monitor.interval);
//     console.log("MONITOR" ,monitor)
    
//     const schedulerId = `uptime-monitor:${monitor._id}`; // Uptime monitor model id
//     const userId = monitor.userId?.toString();
//     const targetRoomId = roomId || (userId ? `user:${userId}` : null);

//     const job = await uptimeMonitorQueue.upsertJobScheduler(  // see adding jobs inside that queue after every interval and worker will run immidately seeing a new job .
//         schedulerId, 

//         { every },  // run after every interval

//         {
//             name:"uptime-scheduler-event",  // individual job (name) inside the main queue ie uptimeRobot-india

//             data: {  monitorId: monitor._id.toString(), userId, url: monitor.url, roomId: targetRoomId },

//             opts: {   attempts: 3, // if failed try 3 times 
//                     backoff: { type: "exponential",  delay: 5000 }, // if failing try after 5 seconds then double 
//                     removeOnComplete: 100, // only save last 100 jobs 
//                     removeOnFail: 100 }  
//         }
//     );

//     return {
//         schedulerId,
//         jobId: job?.id,
//         roomId: targetRoomId
//     };
// };


// export const updateUptimeScheduler = async (monitor,roomId) => {

//     return createUptimeScheduler(monitor,roomId);
// };


// export const removeUptimeScheduler = async (monitorId,roomId) => {

//     const schedulerId = `uptime-monitor:${monitorId}`;

//     const removed = await uptimeMonitorQueue.removeJobScheduler(
//         schedulerId
//     );

//     return {...removed , roomId}






// uptime WORKER USING BULLMQ : 

// import { Worker } from "bullmq";
// import { sharedWorkerRedisConnection } from "../config/redis.js";
// import { checkUrl } from "../Services/uptimeChecker.Service.js";
// import { UptimeMonitor } from "../Models/UptimeMonitor.Model.js";
// import { UptimeResult } from "../Models/UptimeResults.Model.js";

// export const startUptimeWorker = () => {
//   const worker = new Worker(
//     "uptimeRobot-india",
//     async (job) => {
//       console.log("Processing uptimeMonitor for :", job.data);

//       const { monitorId, url, userId, roomId } = job.data;

//       if (!url || !monitorId) {
//         throw new Error(`Invalid job data. monitorId: ${monitorId}, URL: ${url}`);
//       }

//       const targetRoomId = roomId || (userId ? `user:${userId}` : null);

//       console.log("room id ",targetRoomId )
//       const checkedAt = new Date();

//       if (!userId) {
//         throw new Error(`Missing userId in job data for monitor ${monitorId}`);
//       }

//       // 1. Run the check: a site error becomes a DOWN result, not a job failure
//       let result;
//       try {
//         result = await checkUrl(url);
//       } catch (error) {
//         console.error(`[Uptime] Check failed for ${url} (monitor ${monitorId}):`, error.message);
//         result = { status: "DOWN", error: error.message || "Uptime check failed" };
//       }

//       const isUp = Boolean(result && result.status !== "DOWN");

//       // 2. Save history + latest result
//       await Promise.all([
//         UptimeResult.create({ monitorId, userId, result, checkedAt }),
//         UptimeMonitor.findByIdAndUpdate(monitorId, {
//           $set: { lastResult: result, lastCheckedAt: checkedAt },
//         }),
//       ]);

//       // 3. Job completes for both UP and DOWN
//       return {
//         jobId: job.id,
//         monitorId,
//         userId,
//         roomId: targetRoomId,
//         url,
//         result,
//         status: isUp ? "up" : "down",
//       };
//     },
//     {
//       connection: sharedWorkerRedisConnection,
//       concurrency: 10,
//     }
//   );

//   worker.on("completed", (job) => {
//     console.log(`Uptime job ${job.id} completed`);
//   });

//   worker.on("failed", (job, error) => {
//     console.error(`Uptime job ${job?.id} failed:`, error.message);
//   });

//   worker.on("error", (error) => {
//     console.error("Uptime worker error:", error);
//   });

//   return worker;
// };

// export default startUptimeWorker;