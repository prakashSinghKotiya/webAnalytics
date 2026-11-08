import { fileURLToPath } from "node:url";
import path from "node:path";
import { connectprismaSQLdb } from "../config/db.prismaSQL.js";
import { startTtfbWorker } from "./ttfb.Worker.js";
import { startLighthouseWorker } from "./Lighthouse.Worker.js";
import { startUptimeWorker } from "./uptime.Worker.js";
import { startUptimeScheduler } from "../Services/uptimeScheduler.Service.js";
import { startDnsWorker } from "./dnsRecordcheck.Worker.js";
import { startRedirectWorker } from "./redirectCheck.Worker.js";
import { startWhoisWorker } from "./whoisLookup.Worker.js";
import { stopPgBoss } from "../queue/boss.js";

let activeWorkers = [];

export const startallworkers = () => {
  console.log("=".repeat(60));
  console.log("[Worker Process] Initializing Web Analysis Background Workers...");
  console.log("=".repeat(60));

  const regions = ["india", "canada","singapore"];
  activeWorkers = [];

  // 1. TTFB Regional Workers (pg-boss)
  regions.forEach((region) => {
    const w = startTtfbWorker(region);
    activeWorkers.push(w);
    console.log(`[Worker] TTFB worker active for region: ${region}`);
  });

  // 2. Lighthouse Worker (pg-boss)
  const lhWorker = startLighthouseWorker();
  activeWorkers.push(lhWorker);
  console.log("[Worker] Lighthouse worker active");

  // 3. Uptime Monitor Worker & Scheduler (pg-boss)
  const upWorker = startUptimeWorker();
  activeWorkers.push(upWorker);
  console.log("[Worker] Uptime monitor worker active");

  const upScheduler = startUptimeScheduler();
  activeWorkers.push(upScheduler);
  console.log("[Worker] Uptime scheduler active");

  // 4. DNS Record Check Worker (pg-boss)
  const dnsWorker = startDnsWorker();
  activeWorkers.push(dnsWorker);
  console.log("[Worker] DNS record check worker active");

  // 5. Redirect Check Worker (pg-boss)
  const redirectWorker = startRedirectWorker();
  activeWorkers.push(redirectWorker);
  console.log("[Worker] Redirect check worker active");

  // 6. WHOIS Lookup Worker (pg-boss)
  const whoisWorker = startWhoisWorker();
  activeWorkers.push(whoisWorker);
  console.log("[Worker] WHOIS lookup worker active");

  console.log("=".repeat(60));
  console.log(`[Worker Process] All ${activeWorkers.length} workers are active and listening for jobs.`);
  console.log("=".repeat(60));
};

const shutdown = async (signal) => {
  console.log(`\n[Worker Process] Received ${signal}. Shutting down all workers safely...`);
  await Promise.allSettled(
    activeWorkers.map(async (workerOrPromise) => {
      const w = await Promise.resolve(workerOrPromise);
      return w?.close?.();
    })
  );
  await stopPgBoss().catch((err) => console.error("[Worker Process] pg-boss stop error:", err));
  console.log("[Worker Process] All workers shut down cleanly.");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const isMainScript = () => {
  if (!process.argv[1]) return false;
  try {
    const entryPath = path.resolve(process.argv[1]);
    const thisPath = fileURLToPath(import.meta.url);
    return entryPath === thisPath;
  } catch {
    return false;
  }
};

if (isMainScript()) {
  try {
    await connectprismaSQLdb();
    console.log("[Worker Process] PostgreSQL connected successfully.");
    startallworkers();
  } catch (err) {
    console.error("[Worker Process] Database connection failed:", err);
    process.exit(1);
  }
}
