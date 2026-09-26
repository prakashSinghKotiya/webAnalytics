import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { performance } from "node:perf_hooks";


const CONFIG = Object.freeze({
  servers: (process.env.DNS_SERVERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  timeoutMs: Number(process.env.DNS_TIMEOUT_MS) || 3000,
  tries: Number(process.env.DNS_TRIES) || 2,
  overallTimeoutMs: Number(process.env.DNS_OVERALL_TIMEOUT_MS) || 10000,
  cacheMaxEntries: Number(process.env.DNS_CACHE_MAX) || 500,
  cacheMinTtlSec: 30,
  cacheMaxTtlSec: 300,
  cacheDefaultTtlSec: 60,
});

export const DNS_RECORD_TYPES = Object.freeze(["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA", "CAA"]);

// NODATA = the domain exists but has no record of this type; NOTFOUND = NXDOMAIN
const NOT_FOUND_CODES = new Set(["ENODATA", "ENOTFOUND"]);
const LABEL_RE = /^(?!-)[a-z0-9_-]{1,63}(?<!-)$/;

export class DnsServiceError extends Error {
  constructor(message, { statusCode = 500, code = "DNS_SERVICE_ERROR", cause } = {}) {
    super(message, { cause });
    this.name = "DnsServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const fetchers = {
  A: (r, h) => r.resolve4(h, { ttl: true }),
  AAAA: (r, h) => r.resolve6(h, { ttl: true }),
  MX: async (r, h) => (await r.resolveMx(h)).sort((a, b) => a.priority - b.priority),
  TXT: async (r, h) => (await r.resolveTxt(h)).map((chunks) => chunks.join("")),
  NS: async (r, h) => (await r.resolveNs(h)).sort(),
  CNAME: (r, h) => r.resolveCname(h),
  SOA: (r, h) => r.resolveSoa(h),
  CAA: (r, h) => r.resolveCaa(h),
};


//checker fn
export function normalizeHostname(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new DnsServiceError("Hostname is required", { statusCode: 400, code: "INVALID_HOSTNAME" });
  }

  const cleaned = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, "");
  const ascii = domainToASCII(cleaned); // handles IDNs like münchen.de

  const valid =
    ascii &&
    ascii.length <= 253 &&
    !isIP(ascii) &&
    ascii.includes(".") &&
    ascii.split(".").every((label) => LABEL_RE.test(label));

  if (!valid) {
    throw new DnsServiceError(`Invalid hostname: "${input}"`, { statusCode: 400, code: "INVALID_HOSTNAME" });
  }
  return ascii;
}


//helper fn
async function resolveOne(resolver, hostname, type) {
  const fetcher = fetchers[type];
  try {
    const data = await fetcher(resolver, hostname);
    return { status: "found", data };
  } catch (err) {
    if (NOT_FOUND_CODES.has(err.code)) {
      return { status: "not_found", code: err.code };
    }
    return { status: "error", code: err.code ?? "UNKNOWN", message: err.message };
  }
}

const summarize = (records) => {
  const results = Object.values(records);
  const count = (status) => results.filter((r) => r.status === status).length;
  const found = count("found");
  const nxdomain = results.some((r) => r.code === "ENOTFOUND");

  return {
    found,
    notFound: count("not_found"),
    error: count("error"),
    domainExists: nxdomain ? false : found > 0 ? true : null, // null = unknown (only errors)
  };
};



//main fn
export async function checkDnsRecords(input, options = {}) {
  const {
    types = DNS_RECORD_TYPES,
    servers = CONFIG.servers,
    timeoutMs = CONFIG.timeoutMs,
    tries = CONFIG.tries,
    overallTimeoutMs = CONFIG.overallTimeoutMs,
    useCache = true,
    signal,
  } = options;

  const hostname = normalizeHostname(input);

  // Only allow known record types - silently drop anything we don't have a fetcher for.
  const requestedTypes = types.filter((t) => DNS_RECORD_TYPES.includes(t));
  if (requestedTypes.length === 0) {
    throw new DnsServiceError("No valid DNS record types requested", { statusCode: 400, code: "INVALID_TYPES" });
  }

  if (signal?.aborted) {
    throw new DnsServiceError("DNS lookup aborted", { statusCode: 499, code: "ABORTED" });
  }

  const resolver = new Resolver({ timeout: timeoutMs, tries });
  if (servers.length) resolver.setServers(servers);

  const cancel = () => resolver.cancel(); // pending queries reject with ECANCELLED
  const timer = setTimeout(cancel, overallTimeoutMs);
  signal?.addEventListener("abort", cancel, { once: true });

  const start = performance.now();

  try {
    const settled = await Promise.allSettled(
      requestedTypes.map((type) => resolveOne(resolver, hostname, type))
    );

    if (signal?.aborted) {
      throw new DnsServiceError("DNS lookup aborted", { statusCode: 499, code: "ABORTED" });
    }

    // settled entries are always "fulfilled" since resolveOne never throws,
    // but guard anyway in case cancellation rejects a query outright.
    const records = Object.fromEntries(
      requestedTypes.map((type, i) => {
        const s = settled[i];
        if (s.status === "fulfilled") return [type, s.value];
        const err = s.reason ?? {};
        return [type, { status: "error", code: err.code ?? "UNKNOWN", message: err.message }];
      })
    );

    const report = {
      hostname,
      resolver: servers.length ? servers : "system",
      resolvedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - start),
      summary: summarize(records),
      records,
      cached: false,
    };

    return report;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}