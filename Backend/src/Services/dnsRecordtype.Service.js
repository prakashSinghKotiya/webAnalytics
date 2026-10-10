// npm i dns-packet
import dns from "node:dns";
import dgram from "node:dgram";
import net from "node:net";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { performance } from "node:perf_hooks";
import packet from "dns-packet";

// Phase 2: DNS_SERVERS env var is read once at startup.
// Restart the worker process after changing .env for CONFIG to update.
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
    sock.on("message", (msg) => {
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

// Phase 4A: recursionDesired is explicit; Phase 2: logs responding server + TTLs
async function rawQuery(ctx, name, type, { recursionDesired = true, targetServer = null } = {}) {
  const { servers, timeoutMs, tries, signal } = ctx;
  const queryServers = targetServer ? [targetServer] : servers;
  let lastErr = codedError("ETIMEOUT", "No DNS server responded");

  for (let attempt = 0; attempt < tries; attempt++) {
    for (const server of queryServers) {
      const id = Math.floor(Math.random() * 65535);
      const buf = packet.encode({
        type: "query",
        id,
        flags: recursionDesired ? packet.RECURSION_DESIRED : 0,
        questions: [{ type, name }],
        additionals: [{ type: "OPT", name: ".", udpPayloadSize: 4096, flags: packet.DNSSEC_OK }],
      });
      try {
        let res = await udpExchange(server, buf, id, timeoutMs, signal);
        if (res.flag_tc) res = await tcpExchange(server, buf, id, timeoutMs, signal);

        // Phase 2: log the server that actually answered and its TTLs
        console.log("[DNS RESPONSE]", {
          queryName: name,
          queryType: type,
          server,
          rcode: res.rcode,
          authoritative: Boolean(res.flag_aa),
          answers: (res.answers || []).map((a) => ({ name: a.name, type: a.type, ttl: a.ttl })),
        });

        return { res, server };
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
  (Array.isArray(data) ? data : [data])
    .map((c) => (Buffer.isBuffer(c) ? c.toString("utf8") : String(c)))
    .join("");

// Resolve A + AAAA for a hostname (cached per request); never throws
function makeIpResolver(ctx) {
  const cache = new Map();
  return (hostname) => {
    const key = hostname.replace(/\.$/, "").toLowerCase();
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        const [v4, v6] = await Promise.allSettled([
          rawQuery(ctx, key, "A"),
          rawQuery(ctx, key, "AAAA"),
        ]);
        const pick = (r, type) =>
          r.status === "fulfilled"
            ? r.value.res.answers
                .filter((a) => a.type === type)
                .map((a) => ({ address: a.data, ttl: a.ttl, type }))
            : [];
        return [...pick(v4, "A"), ...pick(v6, "AAAA")];
      })());
    }
    return cache.get(key);
  };
}

/* ------------------------------------------------------------------ */
/* Phase 4B: Authoritative lookup — NS discovery → direct AA queries  */
/* ------------------------------------------------------------------ */

// Returns [{ server, res, error }] — one entry per authoritative nameserver
async function authoritativeQuery(ctx, name, type) {
  // Step 1: discover NS records via recursive resolver
  let nsResult;
  try {
    nsResult = await rawQuery(ctx, name, "NS", { recursionDesired: true });
  } catch (err) {
    return [{ server: null, res: null, error: err.message }];
  }

  const nsNames = (nsResult.res.answers || [])
    .filter((a) => a.type === "NS")
    .map((a) => a.data.replace(/\.$/, ""));

  if (!nsNames.length) {
    return [{ server: null, res: null, error: "No NS records found for authoritative lookup" }];
  }

  // Step 2: resolve each NS hostname to IPs
  const resolveIPs = makeIpResolver(ctx);
  const nsIpEntries = await Promise.all(
    nsNames.map(async (ns) => {
      const ips = await resolveIPs(ns);
      return { ns, ips };
    })
  );

  // Step 3: query each authoritative server directly (no recursion)
  const results = await Promise.all(
    nsIpEntries.flatMap(({ ns, ips }) =>
      ips.map(async ({ address }) => {
        try {
          const { res } = await rawQuery(ctx, name, type, {
            recursionDesired: false,
            targetServer: address,
          });
          return {
            server: address,
            nsHostname: ns,
            authoritative: Boolean(res.flag_aa),
            rcode: res.rcode,
            res,
            error: null,
          };
        } catch (err) {
          return { server: address, nsHostname: ns, authoritative: false, res: null, error: err.message };
        }
      })
    )
  );

  return results;
}

/* ------------------------------------------------------------------ */
/* Phase 1A: Per-type row builders — correct TTL semantics            */
/* ------------------------------------------------------------------ */

// Phase 3: attach ttlSource + respondingServer to every row
const withMeta = (row, ttlSource, respondingServer, queriedAt) => ({
  ...row,
  ttlSource,
  respondingServer,
  queriedAt,
});

const rowBuilders = {
  A:     (a) => ({ name: a.name, ttl: a.ttl, ip: a.data }),
  AAAA:  (a) => ({ name: a.name, ttl: a.ttl, ip: a.data }),
  CNAME: (a) => ({ name: a.name, ttl: a.ttl, canonical: a.data }),
  NS:    (a) => ({ name: a.name, ttl: a.ttl, value: a.data }),
  PTR:   (a) => ({ name: a.name, ttl: a.ttl, value: a.data }),
  // Phase 1B: SOA — keep record TTL (a.ttl) separate from minimum (a.data.minimum)
  SOA: (a) => ({
    name: a.name,
    ttl: a.ttl,           // SOA record TTL (what the resolver returned)
    mname: a.data.mname,
    rname: a.data.rname,
    serial: a.data.serial,
    refresh: a.data.refresh,
    retry: a.data.retry,
    expire: a.data.expire,
    minimum: a.data.minimum, // negative-caching TTL — distinct from record TTL
  }),
  SRV: (a) => ({ name: a.name, ttl: a.ttl, ...a.data }),
  CAA: (a) => ({ name: a.name, ttl: a.ttl, flags: a.data.flags, tag: a.data.tag, value: a.data.value }),
  TXT: (a) => {
    const value = txtValue(a.data);
    const tag = tagTxt(value);
    return { name: a.name, ttl: a.ttl, value, ...(tag && { tag }) };
  },
  DS: (a) => ({
    name: a.name, ttl: a.ttl,
    keyTag: a.data.keyTag, algorithm: a.data.algorithm,
    digestType: a.data.digestType, digest: a.data.digest?.toString("hex"),
  }),
  DNSKEY: (a) => ({
    name: a.name, ttl: a.ttl,
    flags: a.data.flags, algorithm: a.data.algorithm,
    key: a.data.key?.toString("base64"),
  }),
};

// Phase 1A: MX — ttl = MX record TTL, mxTtl = explicit copy, ipTtl = IP record TTL
async function buildMxRows(answers, name, resolveIPs, ttlSource, respondingServer, queriedAt) {
  const mx = answers.slice().sort((x, y) => x.data.preference - y.data.preference);
  const nested = await Promise.all(
    mx.map(async (a) => {
      const ips = await resolveIPs(a.data.exchange);
      const base = {
        name: a.name || name,
        mx: a.data.exchange,
        preference: a.data.preference,
        ttl: a.ttl,       // MX record TTL — Phase 1A fix
        mxTtl: a.ttl,     // explicit copy for clarity
        ttlSource,
        respondingServer,
        queriedAt,
      };
      return ips.length
        ? ips.map((ip) => ({ ...base, ip: ip.address, ipType: ip.type, ipTtl: ip.ttl }))
        : [{ ...base, ip: null, ipType: null, ipTtl: null }];
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

// Phase 3+5: resolveOne attaches ttlSource, respondingServer, queriedAt to every record row
async function resolveOne(ctx, resolveIPs, hostname, type) {
  const queriedAt = new Date().toISOString();
  try {
    const { res, server } = await rawQuery(ctx, hostname, type);

    if (res.rcode === "NXDOMAIN") return { status: "not_found", type, code: "ENOTFOUND", data: [] };
    if (res.rcode !== "NOERROR") {
      return { status: "error", type, code: res.rcode, message: `Server returned ${res.rcode}`, data: [] };
    }

    const answers = res.answers.filter((a) => a.type === type);
    if (!answers.length) return { status: "not_found", type, code: "ENODATA", data: [] };

    // Phase 3: recursive resolver → ttlSource = "recursive"
    const ttlSource = "recursive";
    const respondingServer = server;

    const data = type === "MX"
      ? await buildMxRows(answers, hostname, resolveIPs, ttlSource, respondingServer, queriedAt)
      : answers.map((a) => withMeta(rowBuilders[type](a), ttlSource, respondingServer, queriedAt));

    return { status: "found", type, data, respondingServer, queriedAt };
  } catch (err) {
    return { status: "error", type, code: err.code ?? "UNKNOWN", message: err.message, data: [] };
  }
}

// Phase 4B: authoritative lookup for a single type — returns per-server results
async function resolveOneAuthoritative(ctx, hostname, type) {
  const queriedAt = new Date().toISOString();
  const serverResults = await authoritativeQuery(ctx, hostname, type);

  return serverResults.map(({ server, nsHostname, authoritative, rcode, res, error }) => {
    if (error || !res) {
      return { server, nsHostname, authoritative: false, status: "error", code: "ETIMEOUT", message: error, data: [] };
    }
    if (rcode === "NXDOMAIN") {
      return { server, nsHostname, authoritative, status: "not_found", code: "ENOTFOUND", data: [] };
    }
    if (rcode !== "NOERROR") {
      return { server, nsHostname, authoritative, status: "error", code: rcode, message: `Server returned ${rcode}`, data: [] };
    }

    const answers = (res.answers || []).filter((a) => a.type === type);
    if (!answers.length) {
      return { server, nsHostname, authoritative, status: "not_found", code: "ENODATA", data: [] };
    }

    const ttlSource = authoritative ? "authoritative" : "recursive";
    const data = answers.map((a) =>
      withMeta(rowBuilders[type]?.(a) ?? { name: a.name, ttl: a.ttl }, ttlSource, server, queriedAt)
    );

    return { server, nsHostname, authoritative, status: "found", data, queriedAt };
  });
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
    // Phase 4: set mode: "recursive" (default) | "authoritative" | "both"
    mode = "recursive",
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

  // Phase 2: fall back to system resolvers when none configured; shuffle for random selection
  const systemServers = dns.getServers()
    .map((s) => s.replace(/^\[|\](:\d+)?$/g, ""))
    .filter((s) => isIP(s));

  const candidateServers = (servers.length ? servers : systemServers)
    .map((s) => s.replace(/^\[|\](:\d+)?$/g, ""))
    .filter((s) => isIP(s));

  // Phase 2: random server selection when no explicit server is configured
  const effectiveServers = servers.length
    ? candidateServers
    : candidateServers.sort(() => Math.random() - 0.5);

  if (!effectiveServers.length) {
    throw new DnsServiceError("No DNS servers available", { statusCode: 500, code: "NO_SERVERS" });
  }

  // Phase 2: log effective resolver configuration
  console.log("[DNS CONFIG]", {
    configuredServers: CONFIG.servers,
    systemServers,
    effectiveServers,
    mode,
  });

  const combined = AbortSignal.any([
    AbortSignal.timeout(overallTimeoutMs),
    ...(signal ? [signal] : []),
  ]);
  const ctx = { servers: effectiveServers, timeoutMs, tries, signal: combined };
  const resolveIPs = makeIpResolver(ctx);
  const start = performance.now();

  // Phase 4: run recursive and/or authoritative queries based on mode
  const [recursiveSettled, authSettled] = await Promise.all([
    (mode === "recursive" || mode === "both")
      ? Promise.all(requestedTypes.map((type) => resolveOne(ctx, resolveIPs, hostname, type)))
      : Promise.resolve([]),
    (mode === "authoritative" || mode === "both")
      ? Promise.all(requestedTypes.map((type) =>
          resolveOneAuthoritative(ctx, hostname, type).then((r) => ({ type, results: r }))
        ))
      : Promise.resolve([]),
  ]);

  if (signal?.aborted) {
    throw new DnsServiceError("DNS lookup aborted", { statusCode: 499, code: "ABORTED" });
  }

  // Phase 5: normalize ECANCELLED → ETIMEOUT
  const normalize = (r) =>
    r.code === "ECANCELLED" ? { ...r, code: "ETIMEOUT", message: "Overall timeout reached" } : r;

  const records = Object.fromEntries(
    recursiveSettled.map((r) => [r.type, normalize(r)])
  );

  // Phase 4B: attach per-server authoritative results under authoritativeRecords
  const authoritativeRecords = Object.fromEntries(
    authSettled.map(({ type, results }) => [type, results.map(normalize)])
  );

  return {
    hostname,
    resolver: effectiveServers,
    resolvedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - start),
    mode,
    summary: summarize(records),
    records,
    ...(mode !== "recursive" && { authoritativeRecords }),
  };
}

/* ------------------------------------------------------------------ */
/* Text report                                                         */
/* ------------------------------------------------------------------ */

const FIELDS = {
  A:      [["Name", "name"], ["TTL", "ttl"], ["TTL Source", "ttlSource"], ["Server", "respondingServer"], ["IP", "ip"]],
  AAAA:   [["Name", "name"], ["TTL", "ttl"], ["TTL Source", "ttlSource"], ["Server", "respondingServer"], ["IP", "ip"]],
  CNAME:  [["Name", "name"], ["TTL", "ttl"], ["TTL Source", "ttlSource"], ["Server", "respondingServer"], ["Value", "canonical"]],
  MX:     [["Name", "name"], ["MX TTL", "mxTtl"], ["IP TTL", "ipTtl"], ["TTL Source", "ttlSource"],
           ["Server", "respondingServer"], ["IP", "ip"], ["MX Host", "mx"], ["Preference", "preference"]],
  NS:     [["Name", "name"], ["TTL", "ttl"], ["TTL Source", "ttlSource"], ["Server", "respondingServer"], ["Value", "value"]],
  PTR:    [["Name", "name"], ["TTL", "ttl"], ["TTL Source", "ttlSource"], ["Server", "respondingServer"], ["Value", "value"]],
  SRV:    [["Name", "name"], ["TTL", "ttl"], ["TTL Source", "ttlSource"], ["Server", "respondingServer"],
           ["Priority", "priority"], ["Weight", "weight"], ["Port", "port"], ["Target", "target"]],
  // Phase 1B: SOA labels distinguish record TTL from negative-caching minimum
  SOA:    [["Name", "name"], ["SOA Record TTL", "ttl"], ["TTL Source", "ttlSource"], ["Server", "respondingServer"],
           ["MName", "mname"], ["RName", "rname"], ["Serial", "serial"],
           ["Refresh", "refresh"], ["Retry", "retry"], ["Expire", "expire"],
           ["Negative Cache Min", "minimum"]],
  TXT:    [["Name", "name"], ["TTL", "ttl"], ["TTL Source", "ttlSource"], ["Server", "respondingServer"],
           ["Value", "value", (v) => JSON.stringify(v)]],
  CAA:    [["Name", "name"], ["TTL", "ttl"], ["TTL Source", "ttlSource"], ["Server", "respondingServer"],
           ["Flags", "flags"], ["Tag", "tag"], ["Value", "value"]],
  DS:     [["Name", "name"], ["TTL", "ttl"], ["TTL Source", "ttlSource"], ["Server", "respondingServer"],
           ["KeyTag", "keyTag"], ["Algorithm", "algorithm"], ["DigestType", "digestType"], ["Digest", "digest"]],
  DNSKEY: [["Name", "name"], ["TTL", "ttl"], ["TTL Source", "ttlSource"], ["Server", "respondingServer"],
           ["Flags", "flags"], ["Algorithm", "algorithm"], ["Key", "key"]],
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
   // Recursive (default) — uses DNS_SERVERS env var (8.8.8.8)
   const result = await checkDnsRecords("example.com");

   // Authoritative — queries NS servers directly, verifies AA flag
   const authResult = await checkDnsRecords("example.com", { mode: "authoritative" });

   // Both modes in one call
   const bothResult = await checkDnsRecords("example.com", { mode: "both" });

   console.log(formatReport(result));
   res.json(result);
*/
