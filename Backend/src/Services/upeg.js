import http from "node:http";
import https from "node:https";
import dnsPromises from "node:dns/promises";
import dns from "node:dns";
import { URL } from "node:url";
import { performance } from "node:perf_hooks";



export const checkUrl = async (targetUrl, options = {}) => {
  const {
    timeout = 10000,
    degradedThreshold = 3000,
    maxRedirects = 6,
    userAgent = "WebAppMonitor/2.0",
  } = options;

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return {
      status: "DOWN",
      reason: "INVALID_URL",
      httpStatus: null,
      TotalresponseTime: null,
      ttfb: null,
      timestamp: new Date().toISOString(),
    };
  }

  const hostname = parsedUrl.hostname;
  const rootDomain = extractRootDomain(hostname);

  // Parallel Execution: HTTP tracer, full DNS records, and RDAP/WHOIS
  const [httpTraceResult, dnsRecordsResult, whoisResult] = await Promise.allSettled([
    traceRedirectsAndHealth(parsedUrl.toString(), {
      timeout,
      degradedThreshold,
      maxRedirects,
      userAgent,
    }),
    resolveDnsRecords(hostname),
    fetchWhoisRdap(rootDomain),
  ]);

  // Aggregate HTTP probe data
  const httpData = httpTraceResult.status === "fulfilled"
    ? httpTraceResult.value
    : {
        status: "DOWN",
        reason: httpTraceResult.reason?.code || httpTraceResult.reason?.message || "HTTP_PROBE_FAILED",
        httpStatus: null,
        TotalresponseTime: null,
        ttfb: null,
        DNSTime: null,
        dnsAddress: null,
        redirectCount: 0,
        redirectChain: [],
      };

  return {
    checkingFor: hostname,
    rootDomain,
    status: httpData.status,
    reason: httpData.reason,
    httpStatus: httpData.httpStatus,
    TotalresponseTime: httpData.TotalresponseTime,
    ttfb: httpData.ttfb,
    DNSTime: httpData.DNSTime,
    dnsAddress: httpData.dnsAddress,
    redirects: {
      count: httpData.redirectCount,
      chain: httpData.redirectChain,
    },
    dnsRecords: dnsRecordsResult.status === "fulfilled" ? dnsRecordsResult.value : null,
    whois: whoisResult.status === "fulfilled" ? whoisResult.value : null,
    timestamp: new Date().toISOString(),
  };
};

// ==========================================
// 1. HTTP Probe & Redirect Chain Tracker
// ==========================================

async function traceRedirectsAndHealth(initialUrl, { timeout, degradedThreshold, maxRedirects, userAgent }) {
  let currentUrl = initialUrl;
  const chain = [];
  const visitedUrls = new Set();
  const suiteStartTime = performance.now();

  let firstHopTtfb = null;
  let firstHopDnsTime = null;
  let firstHopDnsAddress = null;

  for (let hop = 1; hop <= maxRedirects; hop++) {
    if (visitedUrls.has(currentUrl)) {
      throw Object.assign(new Error("Circular redirect loop detected"), { code: "REDIRECT_LOOP" });
    }
    visitedUrls.add(currentUrl);

    const hopResult = await executeSingleProbe(currentUrl, { timeout, userAgent });

    if (hop === 1) {
      firstHopTtfb = hopResult.ttfb;
      firstHopDnsTime = hopResult.dnsTime;
      firstHopDnsAddress = hopResult.dnsAddress;
    }

    chain.push({
      hop,
      url: currentUrl,
      httpStatus: hopResult.statusCode,
      dnsAddress: hopResult.dnsAddress,
      timing: {
        dnsTimeMs: hopResult.dnsTime,
        ttfbMs: hopResult.ttfb,
        hopDurationMs: hopResult.hopDuration,
      },
      location: hopResult.location,
    });

    const isRedirect = [301, 302, 303, 307, 308].includes(hopResult.statusCode);
    if (!isRedirect || !hopResult.location) {
      break;
    }

    if (hop === maxRedirects) {
      throw Object.assign(new Error("Max redirect limit exceeded"), { code: "TOO_MANY_REDIRECTS" });
    }

    // Resolve relative redirects (e.g. location: "/auth/login")
    currentUrl = new URL(hopResult.location, currentUrl).toString();
  }

  const finalHop = chain[chain.length - 1];
  const totalSuiteDuration = Math.round(performance.now() - suiteStartTime);

  // Status classification
  let status = "DOWN";
  let reason = "HTTP_ERROR";

  if (finalHop.httpStatus >= 200 && finalHop.httpStatus < 400) {
    if (totalSuiteDuration >= degradedThreshold) {
      status = "DEGRADED";
      reason = "HIGH_RESPONSE_TIME";
    } else {
      status = "UP";
      reason = "HTTP_OK";
    }
  } else if (finalHop.httpStatus >= 400 && finalHop.httpStatus < 500) {
    status = "DOWN";
    reason = "HTTP_CLIENT_ERROR";
  } else if (finalHop.httpStatus >= 500) {
    status = "DOWN";
    reason = "HTTP_SERVER_ERROR";
  }

  return {
    status,
    reason,
    httpStatus: finalHop.httpStatus,
    TotalresponseTime: totalSuiteDuration,
    ttfb: firstHopTtfb,
    DNSTime: firstHopDnsTime,
    dnsAddress: firstHopDnsAddress,
    redirectCount: chain.length - 1,
    redirectChain: chain,
  };
}

function executeSingleProbe(targetUrl, { timeout, userAgent }) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const client = url.protocol === "https:" ? https : http;

    const startTime = performance.now();
    let dnsStartTime = null;
    let dnsTime = null;
    let dnsAddress = null;
    let ttfb = null;
    let isSettled = false;

    const timer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        req.destroy();
        reject(Object.assign(new Error("Request timed out"), { code: "ETIMEDOUT" }));
      }
    }, timeout);

    const req = client.request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": userAgent,
          "Accept": "*/*",
          "Connection": "close",
        },
        lookup: (hostname, options, callback) => {
          dnsStartTime = performance.now();
          dns.lookup(hostname, options, (err, address, family) => {
            dnsTime = Math.round(performance.now() - dnsStartTime);
            if (!err) {
              dnsAddress = address;
            }
            callback(err, address, family);
          });
        },
      },
      (res) => {
        ttfb = Math.round(performance.now() - startTime);

        // Discard incoming body stream immediately to keep memory usage near zero
        res.resume();

        res.on("end", () => {
          if (isSettled) return;
          isSettled = true;
          clearTimeout(timer);

          resolve({
            statusCode: res.statusCode,
            location: res.headers.location || null,
            dnsAddress,
            dnsTime,
            ttfb,
            hopDuration: Math.round(performance.now() - startTime),
          });
        });
      }
    );

    req.on("error", (err) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      reject(err);
    });

    req.end();
  });
}

// ==========================================
// 2. Comprehensive DNS Records Resolver
// ==========================================

async function resolveDnsRecords(hostname) {
  const recordTypes = ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA"];
  const records = {};

  await Promise.all(
    recordTypes.map(async (type) => {
      try {
        records[type] = await dnsPromises.resolve(hostname, type);
      } catch (err) {
        // ENODATA or ENOTFOUND simply means that particular record type doesn't exist
        records[type] = null;
      }
    })
  );

  return records;
}

// ==========================================
// 3. WHOIS / RDAP Data Provider
// ==========================================

async function fetchWhoisRdap(rootDomain) {
  try {
    const response = await fetch(`https://rdap.org/domain/${rootDomain}`, {
      method: "GET",
      headers: { Accept: "application/rdap+json" },
      signal: AbortSignal.timeout(4000), // Strict 4s timeout for external RDAP
    });

    if (!response.ok) {
      return { error: `RDAP lookup failed with status: ${response.status}` };
    }

    const data = await response.json();
    const events = Array.isArray(data.events) ? data.events : [];

    const registrationEvent = events.find((e) => e.eventAction === "registration");
    const expirationEvent = events.find((e) => e.eventAction === "expiration");
    const lastUpdateEvent = events.find((e) => e.eventAction === "last changed");

    // Extract Registrar Entity name
    let registrarName = "Unknown";
    if (Array.isArray(data.entities)) {
      const regEntity = data.entities.find((ent) => ent.roles?.includes("registrar"));
      if (regEntity?.vcardArray?.[1]) {
        const fnField = regEntity.vcardArray[1].find((item) => item[0] === "fn");
        if (fnField) registrarName = fnField[3];
      }
    }

    return {
      domain: data.ldhName || rootDomain,
      registrar: registrarName,
      status: data.status || [],
      createdAt: registrationEvent?.eventDate || null,
      expiresAt: expirationEvent?.eventDate || null,
      updatedAt: lastUpdateEvent?.eventDate || null,
      nameservers: data.nameservers?.map((ns) => ns.ldhName) || [],
    };
  } catch (err) {
    return {
      error: err.name === "TimeoutError" ? "RDAP_TIMEOUT" : err.message,
    };
  }
}

// ==========================================
// Helper Utilities
// ==========================================

function extractRootDomain(hostname) {
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join(".");
}