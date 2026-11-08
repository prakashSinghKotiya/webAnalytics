import { checkUrl } from "./uptimeChecker.js";

const MAX_BATCH_LIMIT = 100;

/**
 * AWS Lambda handler for batched uptime checks.
 *
 * Accepts:
 * {
 *   monitors: [
 *     { id: 1, url: "https://example.com" },
 *     ...
 *   ]
 * }
 *
 * Returns:
 * {
 *   results: [
 *     { monitorId: 1, result: { status: "UP", httpStatus: 200, ... } },
 *     ...
 *   ]
 * }
 *
 * @param {object} event - Invocation payload
 * @returns {Promise<{ results: Array<{ monitorId: number|string, result: object }> }>}
 */
export const handler = async (event) => {
  try {
    const rawMonitors = event?.monitors;

    if (!Array.isArray(rawMonitors)) {
      throw new Error("Invalid payload: 'monitors' must be an array of { id, url }");
    }

    // Cap at 100 monitors per batch
    const batch = rawMonitors.slice(0, MAX_BATCH_LIMIT);

    const results = await Promise.all(
      batch.map(async (item) => {
        const monitorId = item?.id;
        const targetUrl = item?.url;

        if (!targetUrl || monitorId == null) {
          return {
            monitorId,
            result: {
              status: "DOWN",
              reason: "INVALID_URL",
              error: "Missing URL or monitorId",
            },
          };
        }

        try {
          const result = await checkUrl(targetUrl);
          return {
            monitorId,
            result,
          };
        } catch (err) {
          return {
            monitorId,
            result: {
              status: "DOWN",
              reason: "ERROR",
              error: err.message || "Uptime check execution error",
            },
          };
        }
      })
    );

    return {
      results,
    };
  } catch (err) {
    console.error("[Uptime Lambda] Fatal execution error:", err);
    throw err;
  }
};

export default { handler };

