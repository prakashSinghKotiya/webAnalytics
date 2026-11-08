import express from "express";
import crypto from "node:crypto";
import { checkUrl } from "./uptimeChecker.js";

export const app = express();
app.use(express.json({ limit: "2mb" }));

const MAX_BATCH_LIMIT = 100;
const CONCURRENCY_LIMIT = 20;

/**
 * Constant-time comparison between received and expected runner secrets
 * using crypto.timingSafeEqual to prevent side-channel timing attacks.
 *
 * @param {string} received - Secret from x-runner-secret header
 * @param {string} expected - Expected RUNNER_SECRET from environment
 * @returns {boolean}
 */
export const verifySecret = (received, expected) => {
  if (typeof received !== "string" || typeof expected !== "string") {
    return false;
  }
  const bufA = Buffer.from(received, "utf8");
  const bufB = Buffer.from(expected, "utf8");

  if (bufA.length !== bufB.length) {
    // Perform dummy hash comparison of identical length to normalize timing
    const hashA = crypto.createHash("sha256").update(bufA).digest();
    const hashB = crypto.createHash("sha256").update(bufB).digest();
    crypto.timingSafeEqual(hashA, hashB);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Runs a batch of checks with bounded worker pool concurrency.
 *
 * @param {Array<{ id: number|string, url: string }>} monitors - Batch of monitors
 * @param {number} concurrency - Max simultaneous active checks
 * @returns {Promise<Array<{ monitorId: number|string, result: object }>>}
 */
export const executeBatch = async (monitors, concurrency = CONCURRENCY_LIMIT) => {
  const results = new Array(monitors.length);
  let index = 0;

  const worker = async () => {
    while (index < monitors.length) {
      const idx = index++;
      const item = monitors[idx];
      const monitorId = item?.id;
      const targetUrl = item?.url;

      if (!targetUrl || monitorId == null) {
        results[idx] = {
          monitorId,
          result: {
            status: "DOWN",
            reason: "INVALID_URL",
            error: "Missing URL or monitorId",
          },
        };
        continue;
      }

      try {
        const result = await checkUrl(targetUrl);
        results[idx] = {
          monitorId,
          result,
        };
      } catch (err) {
        results[idx] = {
          monitorId,
          result: {
            status: "DOWN",
            reason: "ERROR",
            error: err.message || "HTTP runner check failed",
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

// Health check endpoint
app.get("/health", (req, res) => {
  return res.json({ status: "ok", runner: "http" });
});

// Primary batch checks endpoint
app.post("/run-checks", async (req, res) => {
  const configuredSecret = process.env.RUNNER_SECRET;
  if (!configuredSecret) {
    console.error("[HTTP Runner] RUNNER_SECRET environment variable is missing.");
    return res.status(500).json({
      error: "Server configuration error: RUNNER_SECRET not configured",
    });
  }

  const clientSecret = req.headers["x-runner-secret"];
  if (!verifySecret(clientSecret, configuredSecret)) {
    return res.status(401).json({
      error: "Unauthorized: Invalid or missing x-runner-secret header",
    });
  }

  const monitors = req.body?.monitors;
  if (!Array.isArray(monitors)) {
    return res.status(400).json({
      error: "Invalid payload: 'monitors' must be an array of { id, url }",
    });
  }

  // Cap batch at 100 monitors
  const batch = monitors.slice(0, MAX_BATCH_LIMIT);

  try {
    const results = await executeBatch(batch, CONCURRENCY_LIMIT);
    return res.status(200).json({ results });
  } catch (err) {
    console.error("[HTTP Runner] Error processing batch:", err);
    return res.status(500).json({
      error: "Internal server error while executing check batch",
    });
  }
});

const PORT = Number(process.env.PORT) || 5050;

if (process.argv[1]?.endsWith("server.js")) {
  app.listen(PORT, () => {
    console.log(`[HTTP Runner] Remote uptime runner listening on port ${PORT}`);
  });
}

export default app;

