import { connectprismaSQLdb } from "../config/db.prismaSQL.js";
import { startLighthouseWorker } from "./Lighthouse.Worker.js";
import { stopLighthouseQueue } from "../queue/Lighthouse.queue.js";

console.log("[Lighthouse Worker Process] Connecting to database...");
try {
  await connectprismaSQLdb();
  console.log("[Lighthouse Worker Process] PostgreSQL connected successfully.");
} catch (err) {
  console.error("[Lighthouse Worker Process] Database connection failed:", err);
  process.exit(1);
}

const worker = await startLighthouseWorker();
console.log("[Lighthouse Worker] Worker started and listening for jobs.");

const shutdown = async (signal) => {
  console.log(`\n[Lighthouse Worker Process] Received ${signal}. Shutting down safely...`);
  await worker?.close?.();
  await stopLighthouseQueue();
  console.log("[Lighthouse Worker Process] Worker shut down cleanly.");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

