import { connectprismaSQLdb } from "../config/db.prismaSQL.js";
import { startDnsWorker } from "./dnsRecordcheck.Worker.js";
import { stopDnsQueue } from "../queue/dnsRecordCheck.Queue.js";

console.log("[DNS Worker Process] Connecting to database...");
try {
  await connectprismaSQLdb();
  console.log("[DNS Worker Process] PostgreSQL connected successfully.");
} catch (err) {
  console.error("[DNS Worker Process] Database connection failed:", err);
  process.exit(1);
}

const worker = await startDnsWorker();
console.log("[DNS Worker] Worker started and listening for jobs.");

const shutdown = async (signal) => {
  console.log(`\n[DNS Worker Process] Received ${signal}. Shutting down safely...`);
  await worker?.close?.();
  await stopDnsQueue();
  console.log("[DNS Worker Process] Worker shut down cleanly.");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

