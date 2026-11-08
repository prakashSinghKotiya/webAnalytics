import { connectprismaSQLdb } from "../config/db.prismaSQL.js";
import { startTtfbWorker } from "./ttfb.Worker.js";
import { stopTtfbQueue } from "../queue/ttfb.queue.js";

console.log("[TTFB Worker Process] Connecting to database...");
try {
  await connectprismaSQLdb();
  console.log("[TTFB Worker Process] PostgreSQL connected successfully.");
} catch (err) {
  console.error("[TTFB Worker Process] Database connection failed:", err);
  process.exit(1);
}

const regions = ["india", "canada","singapore"];

const workers = await Promise.all(
  regions.map(async (region) => {
    const w = await startTtfbWorker(region);
    console.log(`[TTFB Worker] Started for region: ${region}`);
    return w;
  })
);

const shutdown = async (signal) => {
  console.log(`\n[TTFB Worker Process] Received ${signal}. Shutting down safely...`);
  await Promise.allSettled(workers.map((w) => w?.close?.()));
  await stopTtfbQueue();
  console.log("[TTFB Worker Process] All TTFB workers shut down cleanly.");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
