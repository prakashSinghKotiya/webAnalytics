import { connectdb } from "../config/db.mongoose.js";
import { startTtfbWorker } from "./ttfb.Worker.js";
import { startLighthouseWorker } from "./Lighthouse.Worker.js";
import { startUptimeWorker } from "./uptime.Worker.js";
import { startDnsWorker } from "./dnsRecordcheck.Worker.js";
import { startRedirectWorker } from "./redirectCheck.Worker.js";
import { startWhoisWorker } from "./whoisLookup.Worker.js";

console.log("=".repeat(60));
console.log("[Worker Process] Initializing Web Analysis Background Workers...");
console.log("=".repeat(60));

// try {
//   await connectdb();
//   console.log("[Worker Process] MongoDB connected successfully.");
// } catch (err) {
//   console.error("[Worker Process] Database connection failed:", err);
//   process.exit(1);
// }


let activeWorkers = [];

export const startallworkers = () => {
  console.log("=".repeat(60));
  console.log("[Worker Process] Initializing Web Analysis Background Workers...");
  console.log("=".repeat(60));

  const regions = ["india", "europe", "usa"];
  activeWorkers = [];

  // 1. TTFB Regional Workers
  regions.forEach((region) => {
    const w = startTtfbWorker(region);
    activeWorkers.push(w);
    console.log(`[Worker] TTFB worker active for region: ${region}`);
  });

  // 2. Lighthouse Worker
  const lhWorker = startLighthouseWorker();
  activeWorkers.push(lhWorker);
  console.log("[Worker] Lighthouse worker active");

  // 3. Uptime Monitor Worker
  const upWorker = startUptimeWorker();
  activeWorkers.push(upWorker);
  console.log("[Worker] Uptime monitor worker active");

  // 4. DNS Record Check Worker
  const dnsWorker = startDnsWorker();
  activeWorkers.push(dnsWorker);
  console.log("[Worker] DNS record check worker active");

  // 5. Redirect Check Worker
  const redirectWorker = startRedirectWorker();
  activeWorkers.push(redirectWorker);
  console.log("[Worker] Redirect check worker active");

  // 6. WHOIS Lookup Worker
  const whoisWorker = startWhoisWorker();
  activeWorkers.push(whoisWorker);
  console.log("[Worker] WHOIS lookup worker active");

  console.log("=".repeat(60));
  console.log(`[Worker Process] All ${activeWorkers.length} workers are active and listening for jobs.`);
  console.log("=".repeat(60));
};

const shutdown = async (signal) => {
  console.log(`\n[Worker Process] Received ${signal}. Shutting down all workers safely...`);
  await Promise.allSettled(activeWorkers.map((w) => w?.close()));
  console.log("[Worker Process] All workers shut down cleanly.");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
