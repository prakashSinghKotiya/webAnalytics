import { normalizePublicHttpUrl } from "./publicUrl.Service.js";

import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import { monitorEventLoopDelay } from "node:perf_hooks";

// ---------- Config ----------
const MAX_CONCURRENCY = Number(process.env.TTFB_MAX_CONCURRENCY || 50);
const DEFAULT_SAMPLES = 3;
const LAG_WARN_MS = 50; // flag results if event loop was lagging

// ---------- Event loop lag monitor (so you can trust/flag results) ----------
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();

// ---------- SSRF protection at connect time ----------
const blocked = new net.BlockList();
for (const [addr, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) blocked.addSubnet(addr, bits, "ipv4");
for (const [addr, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]])
  blocked.addSubnet(addr, bits, "ipv6");

function isBlockedIp(ip, family) {
  if (family === 6 && ip.toLowerCase().startsWith("::ffff:")) {
    const v4 = ip.slice(7);
    if (net.isIPv4(v4)) return blocked.check(v4, "ipv4");
  }
  return blocked.check(ip, family === 6 ? "ipv6" : "ipv4");
}

// Custom lookup: resolves, validates every address, pins what we connect to.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const safe = addresses.filter((a) => !isBlockedIp(a.address, a.family));
    if (safe.length === 0) {
      return callback(new Error("Blocked: target resolves to a non-public address"));
    }
    if (options.all) return callback(null, safe);
    callback(null, safe[0].address, safe[0].family);
  });
}

// ---------- Concurrency limiter ----------
let active = 0;
const waiters = [];
async function acquire() {
  if (active < MAX_CONCURRENCY) { active++; return; }
  await new Promise((resolve) => waiters.push(resolve));
  active++;
}
function release() {
  active--;
  waiters.shift()?.();
}

// ---------- Single measurement ----------
function measureOnce(url, timeoutMs) {
  return new Promise((resolve) => {
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;
    const now = () => Number(process.hrtime.bigint()) / 1e6;

    const t = { start: now(), dns: 0, tcp: 0, tls: 0, sent: 0 };
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: "GET",
        lookup: safeLookup,
        agent: false,                 // fresh socket => true cold TTFB, no pool interference
        servername: net.isIP(url.hostname) ? undefined : url.hostname, // SNI
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Host: url.host,
          "User-Agent": "Mozilla/5.0 (compatible; TTFBMonitor/1.0)",
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Encoding": "identity", // avoid compression CPU skew
          Connection: "close",
        },
      },
      (res) => {
        const t4 = now(); // first response bytes (headers parsed)
        const ttfb = t4 - t.start;
        const waiting = t4 - (t.sent || t.start); // = DevTools "Waiting (TTFB)"
        res.destroy();
        req.destroy();
        done({
          success: true,
          statusCode: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          ttfb: round(ttfb),               // start -> first byte (curl time_starttransfer)
          serverWait: round(waiting),      // request sent -> first byte
          dns: round(t.dns),
          tcp: round(t.tcp),
          tls: round(t.tls),
        });
      }
    );

    req.on("socket", (socket) => {
      let last = t.start;
      socket.once("lookup", () => { const n = now(); t.dns = n - last; last = n; });
      socket.once("connect", () => { const n = now(); t.tcp = n - last; last = n; });
      socket.once("secureConnect", () => { const n = now(); t.tls = n - last; last = n; });
    });

    req.on("finish", () => { t.sent = now(); });

    req.on("error", (err) => {
      if (err.name === "AbortError" || err.code === "ABORT_ERR") {
        return done({ success: false, statusCode: 408, ttfb: null, error: "Request Timeout" });
      }
      done({ success: false, statusCode: null, ttfb: null, error: err.message || "Network Error" });
    });

    req.end();
  });
}

const round = (n) => Math.round(n * 100) / 100;

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------- Public API ----------
export async function measureTTFB(targetUrl, { timeoutMs = 20000, samples = DEFAULT_SAMPLES } = {}) {
  let normalized = String(targetUrl || "").trim();
  if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;

  let url;
  try {
    normalized = normalizePublicHttpUrl(normalized); // your existing validator
    url = new URL(normalized);
  } catch (e) {
    return { success: false, statusCode: null, ttfb: null, error: e.message || "Invalid URL" };
  }

  await acquire();
  try {
    loopDelay.reset();
    const results = [];
    for (let i = 0; i < samples; i++) {
      const r = await measureOnce(url, timeoutMs); // sequential: samples don't compete with each other
      results.push(r);
      if (!r.success && r.statusCode === 408) break; // don't burn time on a dead host
    }

    const good = results.filter((r) => r.success);
    if (good.length === 0) return results[results.length - 1];

    const pick = (k) => round(median(good.map((r) => r[k])));
    const lagMs = loopDelay.mean / 1e6;

    return {
      success: true,
      statusCode: good[good.length - 1].statusCode,
      ok: good[good.length - 1].ok,
       ttfb: pick("serverWait"),        // headline: matches ByteCheck / DevTools "Waiting"
    totalToFirstByte: pick("ttfb"),   // full: DNS + TCP + TLS + wait
     
      dns: pick("dns"),
      tcp: pick("tcp"),
      tls: pick("tls"),
      min: round(Math.min(...good.map((r) => r.ttfb))),
      max: round(Math.max(...good.map((r) => r.ttfb))),
      samples: good.length,
      reliable: lagMs < LAG_WARN_MS, // false => your worker was overloaded, discard/retry
    };
  } finally {
    release();
  }
}
