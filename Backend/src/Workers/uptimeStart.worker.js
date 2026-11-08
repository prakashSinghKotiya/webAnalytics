import { connectprismaSQLdb } from "../config/db.prismaSQL.js";
import { startUptimeWorker } from "./uptime.Worker.js";
import { startUptimeScheduler } from "../Services/uptimeScheduler.Service.js";
import { stopUptimeQueue } from "../queue/uptime.queue.js";

console.log("[Uptime Worker Process] Connecting to database...");
try {
  await connectprismaSQLdb();
  console.log("[Uptime Worker Process] PostgreSQL connected successfully.");
} catch (err) {
  console.error("[Uptime Worker Process] Database connection failed:", err);
  process.exit(1);
}

const worker = await startUptimeWorker();
console.log("[Uptime Worker] Worker started and listening for probe check jobs.");

const scheduler = await startUptimeScheduler();
console.log("[Uptime Worker] Recurring scheduler active.");

const shutdown = async (signal) => {
  console.log(`\n[Uptime Worker Process] Received ${signal}. Shutting down safely...`);
  await Promise.allSettled([
    worker?.close?.(),
    scheduler?.close?.(),
  ]);
  await stopUptimeQueue();
  console.log("[Uptime Worker Process] Uptime worker and scheduler shut down cleanly.");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

