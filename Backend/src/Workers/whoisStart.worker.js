import { connectprismaSQLdb } from "../config/db.prismaSQL.js";
import { startWhoisWorker } from "./whoisLookup.Worker.js";
import { stopPgBoss } from "../queue/boss.js";

console.log("[WHOIS Worker Process] Connecting to database...");
try {
  await connectprismaSQLdb();
  console.log("[WHOIS Worker Process] PostgreSQL connected successfully.");
} catch (err) {
  console.error("[WHOIS Worker Process] Database connection failed:", err);
  process.exit(1);
}

const worker = await startWhoisWorker();
console.log("[WHOIS Worker] Worker started and listening for jobs.");

const shutdown = async (signal) => {
  console.log(`\n[WHOIS Worker Process] Received ${signal}. Shutting down safely...`);
  await worker?.close?.();
  await stopPgBoss().catch((err) => console.error("[WHOIS Worker Process] pg-boss stop error:", err));
  console.log("[WHOIS Worker Process] Worker shut down cleanly.");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

