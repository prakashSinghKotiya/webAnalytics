/**
 * Uptime checker
 * --------------
 * - Zero dependencies: only Node.js built-ins, no third-party APIs
 * - One hard deadline per attempt (DNS + connect + TLS + response body)
 * - Real DNS / TCP / TTFB timings (no estimates)
 * - Retries only for transient failures, with jittered linear backoff
 * - SSRF protection (blocks private/reserved IPs, DNS-rebinding safe)
 * - Optional keyword assertion and AbortSignal support
 * - checkUrl() NEVER rejects and keeps no shared state, so it scales
 *   horizontally; bound concurrency in your scheduler/queue.
 *
 * Requires Node.js >= 18.
 */

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

export const STATUS = Object.freeze({
  UP: "UP",
  DOWN: "DOWN",
  DEGRADED: "DEGRADED",
});

const DEFAULTS = Object.freeze({
  timeout: 10_000, // hard deadline for ONE attempt
  degradedThreshold: 3_000, // ms; slower than this => DEGRADED
  retries: 1, // extra attempts for transient failures only
  retryDelay: 500, // ms; multiplied by attempt number, with jitter
  method: "GET",
  ipFamily: 0, // 0 = auto, 4 = IPv4 only, 6 = IPv6 only
  maxBodyBytes: 1_048_576, // stop reading the body after this many bytes
  allowPrivateNetworks: false, // SSRF guard: block private/reserved targets
});

// Header names are lowercase so user overrides never create duplicates.
// Pass `null` for a header in options.headers to remove a default.
const DEFAULT_HEADERS = Object.freeze({
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
});

// Failures worth re-checking before declaring the target DOWN.
const RETRYABLE_REASONS = new Set([
  "TIMEOUT",
  "DNS_ERROR",
  "CONNECTION_REFUSED",
  "CONNECTION_RESET",
  "CONNECTION_TIMEOUT",
  "HOST_UNREACHABLE",
  "NETWORK_ERROR",
]);
const RETRYABLE_HTTP_STATUS = new Set([502, 503, 504]);

// Certificate/handshake failures: the site is DOWN, and retrying won't help.
const TLS_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "EPROTO",
]);

const EMPTY_OUTCOME = Object.freeze({
  httpStatus: null,
  responseTime: null,
  ttfb: null,
  DNSTime: null,
  tcpConnectTime: null,
  dnsAddress: null,
  error: null,
});

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

const round = (value) =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;

const toBoundedInt = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

const stripBrackets = (hostname) => hostname.replace(/^\[|\]$/g, "");

/**
 * Normalizes IPs for comparison: strips zone IDs and converts IPv4-mapped
 * IPv6 (both "::ffff:1.2.3.4" and the hex form "::ffff:7f00:1" that
 * WHATWG URL produces) into plain IPv4.
 */
const normalizeIp = (ip) => {
  if (typeof ip !== "string") return null;
  const clean = ip.split("%")[0];

  const dotted = clean.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dotted) return dotted[1];

  const hex = clean.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return clean;
};

const getErrorCode = (error) =>
  error?.code ?? error?.errors?.[0]?.code ?? error?.message ?? "UNKNOWN";

const getErrorReason = (error) => {
  const code = getErrorCode(error);

  switch (code) {
    case "EBLOCKED_ADDRESS":
      return "BLOCKED_TARGET";
    case "ENOTFOUND":
    case "EAI_AGAIN":
    case "ENODATA":
    case "ESERVFAIL":
      return "DNS_ERROR";
    case "ECONNREFUSED":
      return "CONNECTION_REFUSED";
    case "ECONNRESET":
    case "EPIPE":
      return "CONNECTION_RESET";
    case "ETIMEDOUT":
    case "ESOCKETTIMEDOUT":
      return "CONNECTION_TIMEOUT";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "HOST_UNREACHABLE";
    default:
      if (typeof code !== "string") return "NETWORK_ERROR";
      if (TLS_ERROR_CODES.has(code) || code.startsWith("ERR_SSL")) {
        return "SSL_ERROR";
      }
      if (code.startsWith("HPE_")) return "INVALID_RESPONSE";
      return "NETWORK_ERROR";
  }
};

/* -------------------------------------------------------------------------- */
/*  SSRF guard                                                                */
/* -------------------------------------------------------------------------- */

const BLOCKED_RANGES = new BlockList();
[
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local + cloud metadata (169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
].forEach(([addr, prefix]) => BLOCKED_RANGES.addSubnet(addr, prefix, "ipv4"));
BLOCKED_RANGES.addAddress("::", "ipv6");
BLOCKED_RANGES.addAddress("::1", "ipv6");
[
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
].forEach(([addr, prefix]) => BLOCKED_RANGES.addSubnet(addr, prefix, "ipv6"));

const isBlockedIp = (ip) => {
  const normalized = normalizeIp(ip);
  const family = normalized ? isIP(normalized) : 0;
  if (!family) return true; // unparseable => treat as unsafe
  return BLOCKED_RANGES.check(normalized, family === 4 ? "ipv4" : "ipv6");
};

const blockedError = (hostname) =>
  Object.assign(new Error(`Blocked address for ${hostname}`), {
    code: "EBLOCKED_ADDRESS",
  });

/**
 * Custom DNS lookup used by the socket. Validating the address HERE (not
 * before the request) closes the DNS-rebinding window, and gives us an
 * accurate DNS timing.
 */
const createLookup = (config, timing) => (hostname, options, callback) => {
  if (typeof options === "function") {
    callback = options;
    options = {};
  } else if (typeof options === "number") {
    options = { family: options };
  }

  const started = performance.now();

  dns.lookup(hostname, options, (err, address, family) => {
    const ended = performance.now();
    timing.dnsMs ??= ended - started;
    timing.dnsEnd = ended;

    if (err) return callback(err);

    if (options.all) {
      const allowed = config.allowPrivateNetworks
        ? address
        : address.filter((a) => !isBlockedIp(a.address));
      if (allowed.length === 0) return callback(blockedError(hostname));
      timing.address ??= normalizeIp(allowed[0].address);
      return callback(null, allowed);
    }

    if (!config.allowPrivateNetworks && isBlockedIp(address)) {
      return callback(blockedError(hostname));
    }
    timing.address ??= normalizeIp(address);
    return callback(null, address, family);
  });
};

/* -------------------------------------------------------------------------- */
/*  Single HTTP attempt                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Performs exactly one request and always resolves (never rejects).
 */
const attemptCheck = (url, config) =>
  new Promise((resolve) => {
    const startedAt = performance.now();
    const bareHost = stripBrackets(url.hostname);
    const isLiteralIp = isIP(bareHost) !== 0;

    const timing = {
      dnsMs: isLiteralIp ? 0 : null,
      dnsEnd: startedAt,
      tcpMs: null,
      ttfbMs: null,
      address: isLiteralIp ? normalizeIp(bareHost) : null,
    };

    let settled = false;
    let req;
    let timer;
    let onAbort;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      config.signal?.removeEventListener("abort", onAbort);

      resolve({
        ...EMPTY_OUTCOME,
        ...result,
        responseTime: round(performance.now() - startedAt),
        ttfb: round(timing.ttfbMs),
        DNSTime: round(timing.dnsMs),
        tcpConnectTime: round(timing.tcpMs),
        dnsAddress: timing.address,
      });
    };

    /** Settle first, then tear down the socket. */
    const finishAndDestroy = (result) => {
      finish(result);
      req?.destroy();
    };

    const failWith = (error) =>
      finish({
        status: STATUS.DOWN,
        reason: getErrorReason(error),
        error: String(getErrorCode(error)),
      });

    const classify = (statusCode, elapsedMs, body) => {
      const accepted = config.acceptedStatusCodes.has(statusCode);

      if (!accepted) {
        if (statusCode >= 500) {
          return { status: STATUS.DOWN, reason: "SERVER_ERROR", httpStatus: statusCode };
        }
        if (statusCode >= 400 || statusCode < 200) {
          return { status: STATUS.DOWN, reason: "HTTP_ERROR", httpStatus: statusCode };
        }
      }

      if (config.keyword !== null && body !== null) {
        if (body.includes(config.keyword) === config.invertKeyword) {
          return { status: STATUS.DOWN, reason: "KEYWORD_MISMATCH", httpStatus: statusCode };
        }
      }

      if (elapsedMs >= config.degradedThreshold) {
        return { status: STATUS.DEGRADED, reason: "HIGH_RESPONSE_TIME", httpStatus: statusCode };
      }

      // 2xx and 3xx both mean the target answered. Redirects are not followed.
      return { status: STATUS.UP, reason: "HTTP_OK", httpStatus: statusCode };
    };

    // --- Pre-flight checks ------------------------------------------------
    if (config.signal?.aborted) {
      finish({ status: STATUS.DOWN, reason: "ABORTED", error: "ABORT_ERR" });
      return;
    }
    if (isLiteralIp && !config.allowPrivateNetworks && isBlockedIp(bareHost)) {
      failWith({ code: "EBLOCKED_ADDRESS" });
      return;
    }

    timer = setTimeout(
      () =>
        finishAndDestroy({
          status: STATUS.DOWN,
          reason: "TIMEOUT",
          error: "ETIMEDOUT",
        }),
      config.timeout
    );

    onAbort = () =>
      finishAndDestroy({ status: STATUS.DOWN, reason: "ABORTED", error: "ABORT_ERR" });
    config.signal?.addEventListener("abort", onAbort, { once: true });

    // --- Request ----------------------------------------------------------
    try {
      const client = url.protocol === "https:" ? https : http;

      req = client.request(
        url,
        {
          method: config.method,
          agent: false, // fresh socket => accurate timings, no pooled state
          family: config.ipFamily,
          headers: config.headers,
          lookup: createLookup(config, timing),
        },
        (res) => {
          timing.ttfbMs = performance.now() - startedAt;
          const statusCode = res.statusCode;

          const wantBody = config.keyword !== null;
          const chunks = [];
          let received = 0;

          const complete = () =>
            classify(
              statusCode,
              performance.now() - startedAt,
              wantBody ? Buffer.concat(chunks).toString("utf8") : null
            );

          res.on("data", (chunk) => {
            if (settled) return;
            received += chunk.length;
            if (wantBody) chunks.push(chunk);
            if (received >= config.maxBodyBytes) finishAndDestroy(complete());
          });
          res.on("end", () => finish(complete()));
          res.on("error", failWith);
          // Connection dropped mid-body: "end" never fires, "close" does.
          res.on("close", () =>
            finish({
              status: STATUS.DOWN,
              reason: "CONNECTION_RESET",
              httpStatus: statusCode,
              error: "ECONNRESET",
            })
          );
        }
      );

      req.on("socket", (socket) => {
        socket.once("connect", () => {
          timing.tcpMs = Math.max(0, performance.now() - timing.dnsEnd);
          // The address actually connected to (correct for IPv4/IPv6 races)
          if (socket.remoteAddress) timing.address = normalizeIp(socket.remoteAddress);
        });
      });

      req.on("error", failWith);
      req.end();
    } catch (error) {
      failWith(error);
    }
  });

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

const parseTarget = (targetUrl) => {
  try {
    const url = new URL(targetUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

const normalizeHeaders = (custom) => {
  const merged = { ...DEFAULT_HEADERS };
  if (custom && typeof custom === "object") {
    for (const [key, value] of Object.entries(custom)) {
      const name = key.toLowerCase();
      if (value === null || value === undefined) delete merged[name];
      else merged[name] = String(value);
    }
  }
  return merged;
};

const normalizeOptions = (options = {}) => {
  const keyword =
    typeof options.keyword === "string" && options.keyword.length > 0
      ? options.keyword
      : null;
  const requestedMethod = String(options.method ?? "").toUpperCase();

  return {
    timeout: toBoundedInt(options.timeout, DEFAULTS.timeout, 1_000, 60_000),
    degradedThreshold: toBoundedInt(
      options.degradedThreshold,
      DEFAULTS.degradedThreshold,
      1,
      600_000
    ),
    retries: toBoundedInt(options.retries, DEFAULTS.retries, 0, 3),
    retryDelay: toBoundedInt(options.retryDelay, DEFAULTS.retryDelay, 0, 10_000),
    // HEAD has no body, so keyword checks force GET
    method: keyword
      ? "GET"
      : ["GET", "HEAD"].includes(requestedMethod)
        ? requestedMethod
        : DEFAULTS.method,
    ipFamily: [0, 4, 6].includes(options.ipFamily)
      ? options.ipFamily
      : DEFAULTS.ipFamily,
    maxBodyBytes: toBoundedInt(
      options.maxBodyBytes,
      DEFAULTS.maxBodyBytes,
      1_024,
      10_485_760
    ),
    allowPrivateNetworks:
      options.allowPrivateNetworks ?? DEFAULTS.allowPrivateNetworks,
    // e.g. [401, 403] for endpoints that are "up" even when auth is required
    acceptedStatusCodes: new Set(
      (Array.isArray(options.acceptedStatusCodes) ? options.acceptedStatusCodes : [])
        .map(Number)
        .filter((c) => Number.isInteger(c) && c >= 100 && c <= 599)
    ),
    keyword,
    invertKeyword: Boolean(options.invertKeyword), // true => keyword must be ABSENT
    headers: normalizeHeaders(options.headers),
    signal: options.signal instanceof AbortSignal ? options.signal : null,
  };
};

const isRetryable = (outcome) =>
  outcome.status === STATUS.DOWN &&
  (RETRYABLE_REASONS.has(outcome.reason) ||
    (outcome.reason === "SERVER_ERROR" &&
      RETRYABLE_HTTP_STATUS.has(outcome.httpStatus)));

const buildResult = ({ checkingFor, outcome }) => ({
  status: outcome.status,
  reason: outcome.reason,
  httpStatus: outcome.httpStatus,

  responseTime: outcome.responseTime,
  TotalresponseTime: outcome.responseTime, // kept for backward compatibility
  ttfb: outcome.ttfb,
  DNSTime: outcome.DNSTime,
  tcpConnectTime: outcome.tcpConnectTime,

  dnsAddress: outcome.dnsAddress,
  checkingFor,

  error: outcome.error,
  timestamp: new Date().toISOString(),
});

const failedResult = (reason, error) =>
  buildResult({
    checkingFor: null,
    outcome: { ...EMPTY_OUTCOME, status: STATUS.DOWN, reason, error },
  });

/**
 * Checks a URL and always resolves with a result object (never rejects).
 *
 * `reason` is one of: HTTP_OK, HIGH_RESPONSE_TIME, SERVER_ERROR, HTTP_ERROR,
 * KEYWORD_MISMATCH, TIMEOUT, DNS_ERROR, CONNECTION_REFUSED, CONNECTION_RESET,
 * CONNECTION_TIMEOUT, HOST_UNREACHABLE, SSL_ERROR, INVALID_RESPONSE,
 * NETWORK_ERROR, BLOCKED_TARGET, INVALID_URL, ABORTED, INTERNAL_ERROR.
 * Results with reason "ABORTED" should be discarded, not stored.
 *
 * @param {string} targetUrl
 * @param {object} [options]
 * @param {number} [options.timeout=10000]             Hard deadline per attempt (ms)
 * @param {number} [options.degradedThreshold=3000]    Slow-response threshold (ms)
 * @param {number} [options.retries=1]                 Extra attempts on transient failures (0-3)
 * @param {number} [options.retryDelay=500]            Base delay between attempts (ms)
 * @param {"GET"|"HEAD"} [options.method="GET"]
 * @param {0|4|6} [options.ipFamily=0]                 Force IPv4 / IPv6, or auto
 * @param {number[]} [options.acceptedStatusCodes]     Extra codes treated as UP (e.g. 401)
 * @param {string} [options.keyword]                   Body must contain this text (forces GET)
 * @param {boolean} [options.invertKeyword=false]      Body must NOT contain the keyword
 * @param {number} [options.maxBodyBytes=1048576]      Stop reading the body after this size
 * @param {boolean} [options.allowPrivateNetworks=false] Allow private/reserved IP targets
 * @param {Record<string,string|null>} [options.headers] Header overrides (null removes a default)
 * @param {AbortSignal} [options.signal]               Cancel the check (graceful shutdown)
 */
export const checkUrl = async (targetUrl, options = {}) => {
  try {
    const url = parseTarget(targetUrl);
    if (!url) return failedResult("INVALID_URL", "ERR_INVALID_URL");

    const config = normalizeOptions(options);
    const checkingFor = url.hostname;

    let outcome;
    let attempts = 0;

    while (true) {
      if (attempts > 0) {
        const delay = config.retryDelay * attempts * (0.75 + Math.random() * 0.5);
        try {
          await sleep(delay, undefined, { signal: config.signal ?? undefined });
        } catch {
          outcome = {
            ...EMPTY_OUTCOME,
            status: STATUS.DOWN,
            reason: "ABORTED",
            error: "ABORT_ERR",
          };
          break;
        }
      }

      attempts += 1;
      outcome = await attemptCheck(url, config);

      if (!isRetryable(outcome) || attempts > config.retries) break;
    }

    return buildResult({ checkingFor, outcome });
  } catch {
    return failedResult("INTERNAL_ERROR", "INTERNAL_ERROR");
  }
};