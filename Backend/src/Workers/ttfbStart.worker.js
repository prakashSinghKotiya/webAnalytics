import { connectdb } from "../config/db.mongoose.js";
import { startTtfbWorker } from "./ttfb.Worker.js";

console.log("[TTFB Worker Process] Connecting to database...");
try {
  await connectdb();
  console.log("[TTFB Worker Process] MongoDB connected successfully.");
} catch (err) {
  console.error("[TTFB Worker Process] Database connection failed:", err);
  process.exit(1);
}

const regions = ["india", "europe", "usa"];

const workers = regions.map((region) => {
  const w = startTtfbWorker(region);
  console.log(`[TTFB Worker] Started for region: ${region}`);
  return w;
});

const shutdown = async (signal) => {
  console.log(`\n[TTFB Worker Process] Received ${signal}. Shutting down safely...`);
  await Promise.allSettled(workers.map((w) => w.close()));
  console.log("[TTFB Worker Process] All TTFB workers shut down cleanly.");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
