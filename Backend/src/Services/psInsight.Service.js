const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];
const STRATEGIES = new Set(["mobile", "desktop", "both"]);

const MAX_CONCURRENT = 4;          // parallel PSI calls
const MAX_QUEUE = 50;              // waiting requests before rejecting with 503
const REQUEST_TIMEOUT_MS = 90_000; // PSI runs can take 10-60s
const MAX_ATTEMPTS = 3;
const RETRYABLE = new Set([500, 502, 503, 504]);

// ==========================================
// Public API
// ==========================================

export async function runPageSpeed(targetUrl, { strategy = "mobile", signal } = {}) {
  if (!STRATEGIES.has(strategy)) {
    throw httpError(400, "strategy must be mobile, desktop or both");
  }
  const url = normalizeUrl(targetUrl);

  if (strategy === "both") {
    const [mobile, desktop] = await Promise.all([
      analyze(url, "mobile", signal),
      analyze(url, "desktop", signal),
    ]);
    return { url, mobile, desktop };
  }

  const result =  await analyze(url, strategy, signal);
  console.log("DATA RECEIVED !!!! :", result)

  return result
}

async function analyze(url, strategy, signal) {
  const json = await limiter.run(() => fetchPsi(url, strategy, signal));
  return formatReport(json, strategy);
}

// ==========================================
// PSI API call with retry
// ==========================================

async function fetchPsi(url, strategy, signal, attempt = 1) {
  const apiKey = "AIzaSyCRxS8U7sMukjR9hsW-y0SC3W0V-sjpf2c" // read lazily (avoids dotenv import-order bugs)
  if (!apiKey) throw httpError(500, "PSI_API_KEY is not configured");
  if (signal?.aborted) throw httpError(499, "Request cancelled by client");

  const api = new URL(PSI_ENDPOINT);
  api.searchParams.set("url", url);
  api.searchParams.set("strategy", strategy);
  api.searchParams.set("key", apiKey);
  CATEGORIES.forEach((c) => api.searchParams.append("category", c));

  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal;

  let res;
  try {
    res = await fetch(api, { signal: combined });
  } catch (err) {
    if (signal?.aborted) throw httpError(499, "Request cancelled by client");
    if (err.name === "TimeoutError") throw httpError(504, "PageSpeed request timed out");
    if (attempt < MAX_ATTEMPTS) return retry(url, strategy, signal, attempt);
    throw httpError(502, `PageSpeed request failed: ${err.message}`);
  }

  if (res.ok) return res.json();

  const body = await res.json().catch(() => ({}));
  const message = body.error?.message || `PageSpeed returned ${res.status}`;

  if (res.status === 429) {
    // Daily quota: retrying is pointless until reset
    if (/per day/i.test(message)) {
      throw httpError(429, "Daily PageSpeed quota exceeded. Try again after midnight Pacific Time.");
    }
    // Per-minute quota: short backoff may succeed
    if (attempt < MAX_ATTEMPTS) return retry(url, strategy, signal, attempt);
  }

  if (RETRYABLE.has(res.status) && attempt < MAX_ATTEMPTS) {
    return retry(url, strategy, signal, attempt);
  }

  // PSI returns 400 for unreachable or invalid target pages
  throw httpError(res.status === 400 ? 422 : res.status, message);
}

async function retry(url, strategy, signal, attempt) {
  await sleep(2000 * attempt); // backoff: 2s, 4s
  return fetchPsi(url, strategy, signal, attempt + 1);
}

// ==========================================
// Concurrency limiter (no data stored, only pending tasks)
// ==========================================

function createLimiter(maxConcurrent, maxQueue) {
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= maxConcurrent || queue.length === 0) return;
    const { task, resolve, reject } = queue.shift();
    active++;
    task().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };

  return {
    run(task) {
      if (queue.length >= maxQueue) {
        return Promise.reject(httpError(503, "Server busy, please try again shortly"));
      }
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        next();
      });
    },
  };
}

const limiter = createLimiter(MAX_CONCURRENT, MAX_QUEUE);

// ==========================================
// Report formatting
// ==========================================

const FIELD_METRICS = {
  LCP: "LARGEST_CONTENTFUL_PAINT_MS",
  INP: "INTERACTION_TO_NEXT_PAINT",
  CLS: "CUMULATIVE_LAYOUT_SHIFT_SCORE",
  FCP: "FIRST_CONTENTFUL_PAINT_MS",
  TTFB: "EXPERIMENTAL_TIME_TO_FIRST_BYTE",
};

const LAB_METRICS = {
  FCP: "first-contentful-paint",
  LCP: "largest-contentful-paint",
  TBT: "total-blocking-time",
  CLS: "cumulative-layout-shift",
  SpeedIndex: "speed-index",
  TTI: "interactive",
  TTFB: "server-response-time",
};

const SKIP_MODES = new Set(["notApplicable", "manual", "informative"]);

function formatReport(json, strategy) {
  const lh = json.lighthouseResult;
  const audits = lh.audits;

  return {
    url: json.id,
    finalUrl: lh.finalDisplayedUrl,
    strategy,
    analyzedAt: json.analysisUTCTimestamp,
    lighthouseVersion: lh.lighthouseVersion,
    scores: mapEntries(lh.categories, (c) => (c.score == null ? null : Math.round(c.score * 100))),
    coreWebVitals: {
      page: formatField(json.loadingExperience),         // real users, this URL
      origin: formatField(json.originLoadingExperience), // real users, whole origin
    },
    labMetrics: mapEntries(LAB_METRICS, (id) => ({
      value: audits[id]?.numericValue != null ? +audits[id].numericValue.toFixed(3) : null,
      display: audits[id]?.displayValue ?? null,
      score: audits[id]?.score ?? null,
    })),
    issues: mapEntries(lh.categories, (c) => failedAudits(c, audits)),
    screenshot: audits["final-screenshot"]?.details?.data ?? null, // base64 image
    warnings: lh.runWarnings ?? [],
  };
}

function formatField(exp) {
  if (!exp?.metrics) return null; // no CrUX data (low-traffic sites)
  return {
    overall: exp.overall_category ?? null, // FAST | AVERAGE | SLOW
    metrics: mapEntries(FIELD_METRICS, (key, name) => {
      const m = exp.metrics[key];
      if (!m) return null;
      return { p75: name === "CLS" ? m.percentile / 100 : m.percentile, rating: m.category };
    }),
  };
}

function failedAudits(category, audits) {
  return category.auditRefs
    .map((ref) => audits[ref.id])
    .filter((a) => a && a.score !== null && a.score < 0.9 && !SKIP_MODES.has(a.scoreDisplayMode))
    .map((a) => ({
      id: a.id,
      title: a.title,
      score: a.score,
      displayValue: a.displayValue ?? null,
      savingsMs: a.details?.overallSavingsMs ?? null,
    }));
}

// ==========================================
// Helpers
// ==========================================

function normalizeUrl(input) {
  if (!input || typeof input !== "string") throw httpError(400, "url is required");
  try {
    const u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error();
    return u.toString();
  } catch {
    throw httpError(400, "Invalid URL");
  }
}

const mapEntries = (obj, fn) =>
  Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v, k)]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const httpError = (status, message) => Object.assign(new Error(message), { status });
