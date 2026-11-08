import { checkUrl } from "../uptimeChecker.Service.js";

const DEFAULT_CONCURRENCY = 20;


export const runLocalBatch = async (monitors, options = {}) => {
  if (!Array.isArray(monitors) || monitors.length === 0) {
    return [];
  }

  const concurrency =
    Number(options.concurrency || process.env.UPTIME_LOCAL_RUNNER_CONCURRENCY) ||
    DEFAULT_CONCURRENCY;

  const results = new Array(monitors.length);
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < monitors.length) {
      const idx = currentIndex++;
      const monitor = monitors[idx];

      try {
        const result = await checkUrl(monitor.url);
        results[idx] = {
          monitorId: monitor.id,
          result,
        };
      } catch (err) {
        results[idx] = {
          monitorId: monitor.id,
          result: {
            status: "DOWN",
            reason: "ERROR",
            error: err.message || "Local check failed unexpectedly",
          },
        };
      }
    }
  };

  const poolSize = Math.min(concurrency, monitors.length);
  const pool = Array.from({ length: poolSize }, () => worker());
  await Promise.all(pool);

  return results;
};

export default runLocalBatch;

