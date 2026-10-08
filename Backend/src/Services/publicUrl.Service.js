import net from "node:net";
import { parse as parseDomain } from "tldts";
import { normalizeHostname } from "./dnsRecordtype.Service.js";

const isPrivateIpv4 = (host) => {
  const [a, b] = host.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
};

const isPrivateIp = (host) => {
  const type = net.isIP(host);
  if (type === 4) return isPrivateIpv4(host);
  if (type === 6) {
    // IPv6 literals include several equivalent textual forms (including IPv4
    // mapped addresses). Reject them at this layer rather than risk an SSRF
    // bypass; public hostnames remain fully supported.
    return true;
  }
  return false;
};

export const normalizePublicHttpUrl = (value) => {
  const raw = String(value || "").trim();
  const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);

  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Enter a valid public HTTP or HTTPS URL without credentials.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || isPrivateIp(hostname)) {
    throw new Error("Private, loopback, and local-network URLs are not allowed.");
  }

  // Domains must be publicly routable. IP literals are permitted only when public.
  if (!net.isIP(hostname) && !parseDomain(hostname).isIcann) {
    throw new Error("Enter a publicly routable URL.");
  }

  return parsed.toString();
};

export const validateTtfbDemoRequest = (req, res, next) => {
  try {
    req.targetUrl = normalizePublicHttpUrl(req.body?.url);
    if (!["india", "europe", "usa"].includes(req.body?.region)) {
      return res.status(400).json({ success: false, error: "Invalid 'region'. Expected india, europe, or usa." });
    }
    return next();
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
};

export const validateAllTtfbDemoRequest = (req, res, next) => {
  try {
    req.targetUrl = normalizePublicHttpUrl(req.body?.url);
    if (req.body?.region !== "All") {
      return res.status(400).json({ success: false, error: "Invalid 'region'. Expected 'All'." });
    }
    return next();
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
};

export const validateLighthouseDemoRequest = (req, res, next) => {
  try {
    req.targetUrl = normalizePublicHttpUrl(req.body?.url);
    const strategy = req.body?.strategy ?? "mobile";
    if (!["mobile", "desktop", "both"].includes(strategy)) {
      return res.status(400).json({ success: false, error: "Invalid 'strategy'. Expected mobile, desktop, or both." });
    }
    req.lighthouseStrategy = strategy;
    return next();
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
};

export const validateDnsDemoRequest = (req, res, next) => {
  try {
    const raw = req.body?.url;
    if (!raw || typeof raw !== "string" || !raw.trim()) {
      return res.status(400).json({ success: false, error: "Missing or invalid 'url' in request body." });
    }
    const hostname = normalizeHostname(raw);
    if (hostname === "localhost" || hostname.endsWith(".localhost") || isPrivateIp(hostname)) {
      throw new Error("Private, loopback, and local-network hostnames are not allowed.");
    }
    req.targetHostname = hostname;
    return next();
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
};

export const validateRedirectDemoRequest = (req, res, next) => {
  try {
    const raw = req.body?.url;
    if (!raw || typeof raw !== "string" || !raw.trim()) {
      return res.status(400).json({ success: false, error: "Missing or invalid 'url' in request body." });
    }
    req.targetUrl = normalizePublicHttpUrl(raw);
    return next();
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
};

export const validateWhoisDemoRequest = (req, res, next) => {
  try {
    const raw = req.body?.url;
    if (!raw || typeof raw !== "string" || !raw.trim()) {
      return res.status(400).json({ success: false, error: "Missing or invalid 'url' in request body." });
    }
    let input = raw.trim().replace(/^\/\//, "");
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
      input = `https://${input}`;
    }
    const parsed = new URL(input);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost") || isPrivateIp(hostname)) {
      throw new Error("Private, loopback, and local-network domains are not allowed.");
    }
    req.targetUrl = raw.trim();
    return next();
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || "Invalid domain format." });
  }
};
