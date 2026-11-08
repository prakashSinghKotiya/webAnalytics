import { connectprismaSQLdb } from "../config/db.prismaSQL.js";
import { startRedirectWorker } from "./redirectCheck.Worker.js";
import { stopPgBoss } from "../queue/boss.js";

console.log("[Redirect Worker Process] Connecting to database...");
try {
  await connectprismaSQLdb();
  console.log("[Redirect Worker Process] PostgreSQL connected successfully.");
} catch (err) {
  console.error("[Redirect Worker Process] Database connection failed:", err);
  process.exit(1);
}

const worker = await startRedirectWorker();
console.log("[Redirect Worker] Worker started and listening for jobs.");

const shutdown = async (signal) => {
  console.log(`\n[Redirect Worker Process] Received ${signal}. Shutting down safely...`);
  await worker?.close?.();
  await stopPgBoss().catch((err) => console.error("[Redirect Worker Process] pg-boss stop error:", err));
  console.log("[Redirect Worker Process] Worker shut down cleanly.");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

