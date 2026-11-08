import { prisma } from "../config/db.prismaSQL.js";
import { boss } from "../queue/boss.js";

/**
 * UUID v4 / general UUID format validation.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Service to Prisma model and database key configuration.
 */
export const SERVICE_CONFIG = Object.freeze({
  ttfb: {
    model: "ttfb",
    dbIdKey: "ttfbdbId",
  },
  dns: {
    model: "dnsRecord",
    dbIdKey: "dnsRecordId",
  },
  dnsrecord: {
    model: "dnsRecord",
    dbIdKey: "dnsRecordId",
  },
  redirect: {
    model: "redirectCheck",
    dbIdKey: "redirectCheckId",
  },
  redirects: {
    model: "redirectCheck",
    dbIdKey: "redirectCheckId",
  },
  whois: {
    model: "whoisLookup",
    dbIdKey: "whoisDbId",
  },
  lighthouse: {
    model: "lighthouse",
    dbIdKey: "lighthousedbId",
  },
});

/**
 * High-performance in-memory TTL cache for UUID -> DB metadata resolution.
 * Prevents redundant pg-boss queries during high-concurrency polling loops.
 */
class MemoryTtlCache {
  constructor(ttlMs = 10 * 60 * 1000, maxSize = 10000) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value) {
    // Basic eviction if maxSize reached
    if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  delete(key) {
    this.store.delete(key);
  }
}

const uuidResolutionCache = new MemoryTtlCache();

/**
 * Infers the canonical service name from a pg-boss queue name.
 */
export const inferServiceFromQueueName = (queueName) => {
  if (!queueName || typeof queueName !== "string") return null;
  const q = queueName.toLowerCase();
  if (q.includes("lighthouse")) return "lighthouse";
  if (q.includes("ttfb")) return "ttfb";
  if (q.includes("dns")) return "dns";
  if (q.includes("redirect")) return "redirect";
  if (q.includes("whois")) return "whois";
  return null;
};

/**
 * Resolves a raw ID (number, string integer, prefixed string, or pg-boss UUID)
 * to its underlying PostgreSQL database integer ID and associated metadata.
 *
 * @param {string|number} rawId Candidate identifier
 * @param {string} [serviceHint] Optional service name (e.g. 'lighthouse')
 * @returns {Promise<{ dbId: number|null, service: string|null, jobData: object|null }>}
 */
export async function resolveJobAndDbId(rawId, serviceHint = null) {
  if (rawId == null) {
    return { dbId: null, service: serviceHint, jobData: null };
  }

  // 1. Direct number
  if (typeof rawId === "number" && !Number.isNaN(rawId)) {
    return { dbId: rawId, service: serviceHint, jobData: null };
  }

  const str = String(rawId).trim();
  if (!str) {
    return { dbId: null, service: serviceHint, jobData: null };
  }

  // 2. Pure integer string (e.g. "42")
  if (/^\d+$/.test(str)) {
    const parsed = parseInt(str, 10);
    return {
      dbId: Number.isNaN(parsed) ? null : parsed,
      service: serviceHint,
      jobData: null,
    };
  }

  // 3. pg-boss UUID (e.g. "7f0e2f5a-e0b4-4b47-862d-9bc3f5727b12")
  if (UUID_REGEX.test(str)) {
    // 3a. Check in-memory cache
    const cached = uuidResolutionCache.get(str);
    if (cached) {
      return {
        dbId: cached.dbId,
        service: cached.service || serviceHint,
        jobData: cached.jobData || null,
      };
    }

    // 3b. Query pg-boss job store
    try {
      const job = await boss.getJobById(str);
      if (job && job.data) {
        const rawDbId =
          job.data.lighthousedbId ||
          job.data.ttfbdbId ||
          job.data.dnsRecordId ||
          job.data.redirectCheckId ||
          job.data.whoisDbId ||
          job.data.recordId ||
          job.data.id ||
          job.data.dbId;

        const resolvedService =
          serviceHint || inferServiceFromQueueName(job.name);

        const parsedDbId = rawDbId ? parseInt(rawDbId, 10) : null;
        const validDbId = Number.isNaN(parsedDbId) ? null : parsedDbId;

        if (validDbId) {
          uuidResolutionCache.set(str, {
            dbId: validDbId,
            service: resolvedService,
            jobData: job.data,
          });
        }

        return {
          dbId: validDbId,
          service: resolvedService,
          jobData: job.data,
        };
      }
    } catch (err) {
      console.warn(`[jobIdResolver] Failed to lookup pg-boss job ${str}:`, err.message);
    }

    // UUID that could not be resolved from pg-boss (never parse trailing digits from a UUID!)
    return { dbId: null, service: serviceHint, jobData: null };
  }

  // 4. Prefixed numeric string (e.g. "demo_ttfb_123" or "record_45")
  // Only executed if NOT a UUID to prevent extracting false positive trailing hex digits
  const match = str.match(/^.*?_?(\d+)$/);
  if (match) {
    const parsed = parseInt(match[1], 10);
    return {
      dbId: Number.isNaN(parsed) ? null : parsed,
      service: serviceHint,
      jobData: null,
    };
  }

  return { dbId: null, service: serviceHint, jobData: null };
}

/**
 * Resolves a database document across any of the 5 demo/worker services
 * using either a PostgreSQL database integer ID or a pg-boss job UUID.
 *
 * @param {object} params
 * @param {string} params.service Name of service ('ttfb', 'lighthouse', 'dns', 'redirect', 'whois')
 * @param {string|number} params.id Identifier (dbId or boss jobId)
 * @param {number|null} [params.userId] Optional authenticated user ID
 * @param {string|null} [params.guestId] Optional guest session ID
 * @returns {Promise<{ doc: object|null, service: string, dbIdKey: string, numericId: number|null, error?: string }>}
 */
export async function resolveServiceRecord({ service, id, userId, guestId }) {
  if (!service) {
    return { doc: null, service: null, dbIdKey: null, numericId: null, error: "invalid_service" };
  }

  const normService = service.toLowerCase();
  const config = SERVICE_CONFIG[normService];
  if (!config) {
    return { doc: null, service: normService, dbIdKey: null, numericId: null, error: "invalid_service" };
  }

  const { dbId } = await resolveJobAndDbId(id, normService);
  if (!dbId || Number.isNaN(dbId)) {
    return { doc: null, service: normService, dbIdKey: config.dbIdKey, numericId: null };
  }

  const where = { id: dbId };
  if (userId) {
    where.userId = Number(userId);
  } else if (guestId) {
    where.guestId = guestId;
  } else {
    return { doc: null, service: normService, dbIdKey: config.dbIdKey, numericId: dbId, error: "unauthorized" };
  }

  const doc = await prisma[config.model].findFirst({ where });
  return {
    doc,
    service: normService,
    dbIdKey: config.dbIdKey,
    numericId: dbId,
  };
}

