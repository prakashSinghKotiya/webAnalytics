import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

export const findRedirects = async (targetUrl, options = {}) => {
  const { timeout = 10000, maxRedirects = 10, userAgent = "RedirectFinder/1.0" } = options;

  let currentUrl;
  try {
    currentUrl = new URL(targetUrl);
    if (!["http:", "https:"].includes(currentUrl.protocol)) throw new Error();
  } catch {
    return { success: false, inputUrl: targetUrl, error: "INVALID_URL", redirectCount: 0, chain: [] };
  }

  const chain = [];
  const visited = new Set();
  const start = performance.now();

  const result = (extra) => ({
    inputUrl: targetUrl,
    finalUrl: chain.at(-1)?.url ?? null,
    finalStatus: chain.at(-1)?.statusCode ?? null,
    redirectCount: Math.max(chain.length - 1, 0),
    totalTimeMs: Math.round(performance.now() - start),
    chain,
    ...extra,
  });

  try {
    // maxRedirects redirects => up to maxRedirects + 1 requests
    for (let hop = 1; hop <= maxRedirects + 1; hop++) {
      const href = currentUrl.toString();
      if (visited.has(href)) throw codedError("REDIRECT_LOOP", `Redirect loop at ${href}`);
      visited.add(href);

      const { statusCode, location, timeMs } = await probe(currentUrl, { timeout, userAgent });
      const nextUrl = REDIRECT_CODES.has(statusCode) && location ? new URL(location, currentUrl) : null;

      chain.push({ hop, url: href, statusCode, redirectsTo: nextUrl?.toString() ?? null, timeMs });

      // Final destination reached (200 or any non-redirect status)
      if (!nextUrl) {
        return result({ success: statusCode >= 200 && statusCode < 300 });
      }
      currentUrl = nextUrl;
    }
    throw codedError("TOO_MANY_REDIRECTS", `Exceeded ${maxRedirects} redirects`);
  } catch (err) {
    // Return the partial chain so you still see where it broke
    return result({ success: false, error: err.code || "REQUEST_FAILED", message: err.message });
  }
};

function probe(url, { timeout, userAgent }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const start = performance.now();

    const req = client.request(
      url,
      { method: "GET", timeout, headers: { "User-Agent": userAgent, Accept: "*/*", Connection: "close" } },
      (res) => {
        resolve({
          statusCode: res.statusCode,
          location: res.headers.location || null,
          timeMs: Math.round(performance.now() - start),
        });
        res.destroy(); // Only headers are needed, skip downloading the body
      }
    );

    req.on("timeout", () => req.destroy(codedError("ETIMEDOUT", "Request timed out")));
    req.on("error", reject);
    req.end();
  });
}

const codedError = (code, message) => Object.assign(new Error(message), { code });
