// npm i dns-packet
import dns from "node:dns";
import dgram from "node:dgram";
import net from "node:net";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { performance } from "node:perf_hooks";
import packet from "dns-packet";

const CONFIG = Object.freeze({
  servers: (process.env.DNS_SERVERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  timeoutMs: Number(process.env.DNS_TIMEOUT_MS) || 3000,
  tries: Number(process.env.DNS_TRIES) || 2,
  overallTimeoutMs: Number(process.env.DNS_OVERALL_TIMEOUT_MS) || 10000,
});

export const DNS_RECORD_TYPES = Object.freeze([
  "A", "AAAA", "CNAME", "MX", "NS", "PTR", "SRV", "SOA", "TXT", "CAA", "DS", "DNSKEY",
]);

const LABEL_RE = /^(?!-)[a-z0-9_-]{1,63}(?<!-)$/;

export class DnsServiceError extends Error {
  constructor(message, { statusCode = 500, code = "DNS_SERVICE_ERROR", cause } = {}) {
    super(message, { cause });
    this.name = "DnsServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const codedError = (code, message) => Object.assign(new Error(message), { code });

/* ------------------------------------------------------------------ */
/* Low-level DNS transport (UDP with TCP fallback)                     */
/* ------------------------------------------------------------------ */

function udpExchange(server, buf, id, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket(isIP(server) === 6 ? "udp6" : "udp4");
    const done = (fn, v) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      try { sock.close(); } catch { /* already closed */ }
      fn(v);
    };
    const onAbort = () => done(reject, codedError("ECANCELLED", "Query cancelled"));
    const timer = setTimeout(() => done(reject, codedError("ETIMEOUT", `Timeout querying ${server}`)), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    sock.on("error", (e) => done(reject, e));
    sock.on("message", (msg, rinfo) => {
      if (rinfo.address !== server && isIP(server)) { /* tolerate NAT/v6 forms */ }
      try {
        const res = packet.decode(msg);
        if (res.id === id) done(resolve, res);
      } catch (e) { done(reject, codedError("EBADRESP", e.message)); }
    });
    sock.send(buf, 53, server, (e) => e && done(reject, e));
  });
}

function tcpExchange(server, buf, id, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: server, port: 53 });
    const chunks = [];
    let total = 0;
    const done = (fn, v) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      sock.destroy();
      fn(v);
    };
    const onAbort = () => done(reject, codedError("ECANCELLED", "Query cancelled"));
    const timer = setTimeout(() => done(reject, codedError("ETIMEOUT", `TCP timeout querying ${server}`)), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    sock.on("error", (e) => done(reject, e));
    sock.on("connect", () => {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(buf.length);
      sock.write(Buffer.concat([len, buf]));
    });
    sock.on("data", (d) => {
      chunks.push(d);
      total += d.length;
      const all = Buffer.concat(chunks, total);
      if (all.length >= 2 && all.length >= all.readUInt16BE(0) + 2) {
        try {
          const res = packet.decode(all.subarray(2, 2 + all.readUInt16BE(0)));
          if (res.id === id) done(resolve, res);
        } catch (e) { done(reject, codedError("EBADRESP", e.message)); }
      }
    });
  });
}

async function rawQuery(ctx, name, type) {
  const { servers, timeoutMs, tries, signal } = ctx;
  let lastErr = codedError("ETIMEOUT", "No DNS server responded");

  for (let attempt = 0; attempt < tries; attempt++) {
    for (const server of servers) {
      const id = Math.floor(Math.random() * 65535);
      const buf = packet.encode({
        type: "query",
        id,
        flags: packet.RECURSION_DESIRED,
        questions: [{ type, name }],
        additionals: [{ type: "OPT", name: ".", udpPayloadSize: 4096, flags: packet.DNSSEC_OK }],
      });
      try {
        let res = await udpExchange(server, buf, id, timeoutMs, signal);
        if (res.flag_tc) res = await tcpExchange(server, buf, id, timeoutMs, signal);
        return res;
      } catch (err) {
        if (err.code === "ECANCELLED") throw err;
        lastErr = err;
      }
    }
  }
  throw lastErr;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function tagTxt(value) {
  const v = value.trimStart().toLowerCase();
  if (v.startsWith("v=spf1")) return "SPF";
  if (v.startsWith("v=dmarc1")) return "DMARC";
  if (v.startsWith("v=dkim1")) return "DKIM";
  return null;
}

const txtValue = (data) =>
  (Array.isArray(data) ? data : [data]).map((c) => (Buffer.isBuffer(c) ? c.toString("utf8") : String(c))).join("");

// Resolve A + AAAA for a hostname (cached per request); never throws
function makeIpResolver(ctx) {
  const cache = new Map();
  return (hostname) => {
    const key = hostname.replace(/\.$/, "").toLowerCase();
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        const [v4, v6] = await Promise.allSettled([rawQuery(ctx, key, "A"), rawQuery(ctx, key, "AAAA")]);
        const pick = (r, type) =>
          r.status === "fulfilled"
            ? r.value.answers.filter((a) => a.type === type).map((a) => ({ address: a.data, ttl: a.ttl, type }))
            : [];
        return [...pick(v4, "A"), ...pick(v6, "AAAA")];
      })());
    }
    return cache.get(key);
  };
}

/* ------------------------------------------------------------------ */
/* Per-type row builders. Every row has: name, ttl, ...type fields     */
/* ------------------------------------------------------------------ */

const rowBuilders = {
  A: (a) => ({ name: a.name, ttl: a.ttl, ip: a.data }),
  AAAA: (a) => ({ name: a.name, ttl: a.ttl, ip: a.data }),
  CNAME: (a) => ({ name: a.name, ttl: a.ttl, canonical: a.data }),
  NS: (a) => ({ name: a.name, ttl: a.ttl, value: a.data }),
  PTR: (a) => ({ name: a.name, ttl: a.ttl, value: a.data }),
  SOA: (a) => ({ name: a.name, ttl: a.ttl, ...a.data }),
  SRV: (a) => ({ name: a.name, ttl: a.ttl, ...a.data }),
  CAA: (a) => ({ name: a.name, ttl: a.ttl, flags: a.data.flags, tag: a.data.tag, value: a.data.value }),
  TXT: (a) => {
    const value = txtValue(a.data);
    const tag = tagTxt(value);
    return { name: a.name, ttl: a.ttl, value, ...(tag && { tag }) };
  },
  DS: (a) => ({
    name: a.name, ttl: a.ttl, keyTag: a.data.keyTag, algorithm: a.data.algorithm,
    digestType: a.data.digestType, digest: a.data.digest?.toString("hex"),
  }),
  DNSKEY: (a) => ({
    name: a.name, ttl: a.ttl, flags: a.data.flags, algorithm: a.data.algorithm,
    key: a.data.key?.toString("base64"),
  }),
};

// MX needs an extra step: one row per (MX host × IP) so the IP + TTL can be shown
async function buildMxRows(answers, name, resolveIPs) {
  const mx = answers.slice().sort((x, y) => x.data.preference - y.data.preference);
  const nested = await Promise.all(
    mx.map(async (a) => {
      const ips = await resolveIPs(a.data.exchange);
      const base = { name: a.name || name, mx: a.data.exchange, preference: a.data.preference, mxTtl: a.ttl };
      return ips.length
        ? ips.map((ip) => ({ ...base, ttl: ip.ttl, ip: ip.address, ipType: ip.type }))
        : [{ ...base, ttl: a.ttl, ip: null }];
    })
  );
  return nested.flat();
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function normalizeHostname(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new DnsServiceError("Hostname is required", { statusCode: 400, code: "INVALID_HOSTNAME" });
  }
  const cleaned = input.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
  const ascii = domainToASCII(cleaned);
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

async function resolveOne(ctx, resolveIPs, hostname, type) {
  try {
    const res = await rawQuery(ctx, hostname, type);

    if (res.rcode === "NXDOMAIN") return { status: "not_found", type, code: "ENOTFOUND", data: [] };
    if (res.rcode !== "NOERROR") {
      return { status: "error", type, code: res.rcode, message: `Server returned ${res.rcode}`, data: [] };
    }

    // Keep only answers of the requested type (A/AAAA queries may include CNAME chain)
    const answers = res.answers.filter((a) => a.type === type);
    if (!answers.length) return { status: "not_found", type, code: "ENODATA", data: [] };

    const data = type === "MX"
      ? await buildMxRows(answers, hostname, resolveIPs)
      : answers.map(rowBuilders[type]);

    return { status: "found", type, data };
  } catch (err) {
    return { status: "error", type, code: err.code ?? "UNKNOWN", message: err.message, data: [] };
  }
}

const summarize = (records) => {
  const results = Object.values(records);
  const count = (s) => results.filter((r) => r.status === s).length;
  const found = count("found");
  const nxdomain = results.some((r) => r.code === "ENOTFOUND");
  return {
    found,
    notFound: count("not_found"),
    error: count("error"),
    domainExists: nxdomain ? false : found > 0 ? true : null,
  };
};

export async function checkDnsRecords(input, options = {}) {
  const {
    types = DNS_RECORD_TYPES,
    servers = CONFIG.servers,
    timeoutMs = CONFIG.timeoutMs,
    tries = CONFIG.tries,
    overallTimeoutMs = CONFIG.overallTimeoutMs,
    signal,
  } = options;

  const hostname = normalizeHostname(input);
  const requestedTypes = [...new Set(types.map((t) => String(t).toUpperCase()))]
    .filter((t) => DNS_RECORD_TYPES.includes(t));
  if (!requestedTypes.length) {
    throw new DnsServiceError("No valid DNS record types requested", { statusCode: 400, code: "INVALID_TYPES" });
  }
  if (signal?.aborted) {
    throw new DnsServiceError("DNS lookup aborted", { statusCode: 499, code: "ABORTED" });
  }

  // Fall back to the system resolvers when none are configured
  const effectiveServers = (servers.length ? servers : dns.getServers())
    .map((s) => s.replace(/^\[|\](:\d+)?$/g, "")) // strip [v6]:port wrapper
    .filter((s) => isIP(s));
  if (!effectiveServers.length) {
    throw new DnsServiceError("No DNS servers available", { statusCode: 500, code: "NO_SERVERS" });
  }

  const combined = AbortSignal.any([
    AbortSignal.timeout(overallTimeoutMs),
    ...(signal ? [signal] : []),
  ]);
  const ctx = { servers: effectiveServers, timeoutMs, tries, signal: combined };
  const resolveIPs = makeIpResolver(ctx);
  const start = performance.now();

  const settled = await Promise.all(
    requestedTypes.map((type) => resolveOne(ctx, resolveIPs, hostname, type))
  );

  if (signal?.aborted) {
    throw new DnsServiceError("DNS lookup aborted", { statusCode: 499, code: "ABORTED" });
  }

  const records = Object.fromEntries(
    settled.map((r) => [
      r.type,
      // Overall timeout / cancellation surfaces as a per-type error rather than a crash
      r.code === "ECANCELLED" ? { ...r, code: "ETIMEOUT", message: "Overall timeout reached" } : r,
    ])
  );

  return {
    hostname,
    resolver: effectiveServers,
    resolvedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - start),
    summary: summarize(records),
    records,
  };
}

/* ------------------------------------------------------------------ */
/* Text report in the requested format                                 */
/* ------------------------------------------------------------------ */

const FIELDS = {
  A: [["Name", "name"], ["ttl", "ttl"], ["ip", "ip"]],
  AAAA: [["Name", "name"], ["ttl", "ttl"], ["ip", "ip"]],
  CNAME: [["Name", "name"], ["ttl", "ttl"], ["value", "canonical"]],
  MX: [["Name", "name"], ["ttl", "ttl"], ["ip", "ip"], ["mx", "mx"], ["preference", "preference"]],
  NS: [["Name", "name"], ["ttl", "ttl"], ["value", "value"]],
  PTR: [["Name", "name"], ["ttl", "ttl"], ["value", "value"]],
  SRV: [["Name", "name"], ["ttl", "ttl"], ["priority", "priority"], ["weight", "weight"], ["port", "port"], ["target", "target"]],
  SOA: [["Name", "name"], ["ttl", "ttl"], ["mname", "mname"], ["rname", "rname"], ["serial", "serial"],
    ["refresh", "refresh"], ["retry", "retry"], ["expire", "expire"], ["minimum", "minimum"]],
  TXT: [["Name", "name"], ["ttl", "ttl"], ["value", "value", (v) => JSON.stringify(v)]],
  CAA: [["Name", "name"], ["ttl", "ttl"], ["flags", "flags"], ["tag", "tag"], ["value", "value"]],
  DS: [["Name", "name"], ["ttl", "ttl"], ["keytag", "keyTag"], ["algorithm", "algorithm"],
    ["digesttype", "digestType"], ["digest", "digest"]],
  DNSKEY: [["Name", "name"], ["ttl", "ttl"], ["flags", "flags"], ["algorithm", "algorithm"], ["key", "key"]],
};

const SEPARATOR = "------------------";
const REPORT_ORDER = ["A", "AAAA", "CNAME", "MX", "NS", "PTR", "SRV", "SOA", "TXT", "CAA", "DS", "DNSKEY"];

export function formatReport(result) {
  const blocks = [];
  for (const type of REPORT_ORDER) {
    const rec = result.records[type];
    if (!rec) continue;

    if (rec.status === "error") {
      blocks.push(`${type} Records: Error (${rec.code}${rec.message ? `: ${rec.message}` : ""})`);
      continue;
    }
    if (rec.status !== "found" || !rec.data.length) {
      blocks.push(`${type} Records: None`);
      continue;
    }

    const lines = rec.data.map((row, i) => {
      const parts = FIELDS[type].map(([label, key, fmt]) => {
        const v = row[key] ?? "-";
        return `${label}: ${fmt && row[key] != null ? fmt(v) : v}`;
      });
      return `[${i}] ${parts.join(" | ")}`;
    });
    blocks.push(`${type} Records :\n\n${lines.join("\n")}`);
  }
  return blocks.join(`\n\n${SEPARATOR}\n\n`) + `\n\n${SEPARATOR}\n`;
}

/* Usage:
   const result = await checkDnsRecords("bloggerspassion.com");
   console.log(formatReport(result));   // text format
   res.json(result);                    // structured JSON (every row has name + ttl)
*/