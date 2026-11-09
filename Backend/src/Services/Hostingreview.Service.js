
import { Prisma } from '@prisma/client';
import { prisma } from '../config/db.prismaSQL.js';

/** Minimum checks required before a provider can be reviewed. */
export const MIN_CHECKS = 100;

/** UptimeResult retention window — matches the DB cleanup policy. */
const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Provider name normalisation                                         */
/* ------------------------------------------------------------------ */

const LEGAL_SUFFIXES = new Set([
  'uab', 'ltd', 'limited', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'co',
  'gmbh', 'ag', 'se', 'sa', 'sas', 'sarl', 'bv', 'nv', 'plc', 'pty', 'pvt', 'lp', 'llp',
  'srl', 'spa', 'ab', 'oy', 'kg', 'ug', 'international', 'holdings', 'group',
]);

/**
 * Map messy ASN/org names onto one canonical key.
 * Add entries here as you encounter new providers.
 */
const PROVIDER_ALIASES = {
  // 'amazon-02': 'aws',
  // 'amazon-aes': 'aws',
  // 'google-cloud-platform': 'google-cloud',
};

const tokenize = (raw) => String(raw).replace(/[.,()]/g, ' ').split(/\s+/).filter(Boolean);

const stripSuffixes = (tokens) => {
  const t = [...tokens];
  while (t.length > 1 && LEGAL_SUFFIXES.has(t[t.length - 1].toLowerCase())) t.pop();
  return t;
};

/** "HOSTINGER, UAB" -> "hostinger" */
export function normalizeProvider(raw) {
  if (!raw) return '';
  const key = stripSuffixes(tokenize(raw))
    .map((t) => t.toLowerCase().replace(/[^a-z0-9-]/g, ''))
    .filter(Boolean)
    .join('-');
  return PROVIDER_ALIASES[key] ?? key;
}

/** "HOSTINGER, UAB" -> "Hostinger" (admin can still override the display name). */
function prettyName(raw) {
  return stripSuffixes(tokenize(raw))
    .map((t) => (t === t.toUpperCase() && t.length > 3 ? t[0] + t.slice(1).toLowerCase() : t))
    .join(' ');
}

/* ------------------------------------------------------------------ */
/* Monitor grouping                                                    */
/* ------------------------------------------------------------------ */

/**
 * Fetch every monitor (belonging to non-deleted users) that has a hostedBy value,
 * then group them by normalised provider key in JS.
 *
 * JS-side normalisation is intentional: the ASN name cleanup logic is too complex
 * for plain SQL. If monitor count grows to 10k+, persist the normalised key on
 * UptimeMonitor at creation time and query directly.
 */
async function groupMonitorsByProvider() {
  const rows = await prisma.$queryRaw`
    SELECT
      m.id,
      m.status::text                    AS status,
      m.hostinginfo->>'hostedBy'        AS "hostedBy"
    FROM "UptimeMonitor" m
    JOIN "User" u ON u.id = m."userId"
    WHERE u.deleted = false
      AND COALESCE(m.hostinginfo->>'hostedBy', '') <> ''`;

  const groups = new Map();
  for (const row of rows) {
    const key = normalizeProvider(row.hostedBy);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = { key, variants: new Map(), monitorIds: [], activeMonitors: 0 };
      groups.set(key, g);
    }
    g.monitorIds.push(Number(row.id));
    if (row.status === 'active') g.activeMonitors += 1;
    g.variants.set(row.hostedBy, (g.variants.get(row.hostedBy) ?? 0) + 1);
  }

  for (const g of groups.values()) {
    const top = [...g.variants.entries()].sort((a, b) => b[1] - a[1])[0][0];
    g.name = prettyName(top);
  }

  return groups;
}

/* ------------------------------------------------------------------ */
/* Math helpers                                                        */
/* ------------------------------------------------------------------ */

const num   = (v) => (v === null || v === undefined ? null : Number(v));
const round = (v, d = 0) => (v === null || v === undefined ? null : Number(Number(v).toFixed(d)));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pct   = (up, total) => (total ? round((up / total) * 100, 3) : null);

/* ------------------------------------------------------------------ */
/* SQL building blocks — PostgreSQL 10 compatible                      */
/* ------------------------------------------------------------------ */

/**
 * Build a Prisma.sql fragment that produces clean typed rows for a set of
 * monitor IDs within a time window.
 *
 * PG10 note: We use Prisma.join to build the IN list instead of ANY(::int[])
 * because passing a JS array directly as ::int[] is unreliable across Prisma
 * versions on PG10. Prisma.join produces: (1,2,3,...) which works with IN.
 */
function baseRows(ids, from, to) {
  const idList = Prisma.join(ids.map((id) => Prisma.sql`${id}`));
  return Prisma.sql`
    SELECT
      r."monitorId"                                                   AS mid,
      r."checkedAt"                                                   AS at,
      upper(r.result->>'status')                                      AS s,
      CASE
        WHEN r.result->>'responseTime' ~ '^[0-9]+(\\.[0-9]+)?$'
        THEN (r.result->>'responseTime')::float8
      END                                                             AS rt
    FROM "UptimeResult" r
    WHERE r."monitorId" IN (${idList})
      AND r."checkedAt" >= ${from}
      AND r."checkedAt" <  ${to}
      AND upper(r.result->>'status') IN ('UP', 'DOWN')`;
}

/**
 * Aggregate totals, response-time stats, and time bounds for a window.
 *
 * PG10 note: percentile_cont does NOT support FILTER (WHERE ...) in PG10.
 * We use a CASE WHEN inside the ordered-set aggregate to substitute NULL
 * for rows we want to exclude, which is the PG10-compatible pattern.
 */
async function aggregateWindow(ids, from, to) {
  const base = baseRows(ids, from, to);
  const [row] = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int                                                   AS total,
      COUNT(CASE WHEN s = 'UP'   THEN 1 END)::int                    AS up,
      COUNT(CASE WHEN s = 'DOWN' THEN 1 END)::int                    AS down,
      AVG(CASE WHEN s = 'UP' THEN rt END)::float8                    AS "avgRt",
      MIN(CASE WHEN s = 'UP' THEN rt END)::float8                    AS "minRt",
      MAX(CASE WHEN s = 'UP' THEN rt END)::float8                    AS "maxRt",
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY CASE WHEN s = 'UP' THEN rt END)
                                                                      AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY CASE WHEN s = 'UP' THEN rt END)
                                                                      AS p95,
      MIN(at)                                                         AS "firstAt",
      MAX(at)                                                         AS "lastAt"
    FROM (${base}) t`;
  return row;
}

/**
 * Incident + streak analysis via gaps-and-islands, across all monitors.
 *
 * PG10 note: FILTER on COUNT is supported in PG9.4+, so COUNT(*) FILTER (WHERE ...)
 * is fine. The issue was only with ordered-set aggregates (percentile_cont).
 * We keep FILTER here because it is valid PG10 syntax.
 */
async function streakStats(ids, from, to) {
  const base = baseRows(ids, from, to);
  const [row] = await prisma.$queryRaw`
    WITH numbered AS (
      SELECT
        mid, at, s,
        ROW_NUMBER() OVER (PARTITION BY mid ORDER BY at)
        - ROW_NUMBER() OVER (PARTITION BY mid, s ORDER BY at) AS grp
      FROM (${base}) b
    ),
    runs AS (
      SELECT mid, s, COUNT(*)::int AS len
      FROM numbered
      GROUP BY mid, s, grp
    )
    SELECT
      COUNT(*) FILTER (WHERE s = 'DOWN')::int                        AS incidents,
      COALESCE(MAX(CASE WHEN s = 'UP'   THEN len END), 0)::int       AS "longestUp",
      COALESCE(MAX(CASE WHEN s = 'DOWN' THEN len END), 0)::int       AS "longestDown"
    FROM runs`;
  return row;
}

/**
 * Per-monitor breakdown (top 5 by check volume, anonymised for public display).
 */
async function perMonitorStats(ids, from, to) {
  const base = baseRows(ids, from, to);
  return prisma.$queryRaw`
    SELECT
      mid                                                             AS "monitorId",
      COUNT(*)::int                                                   AS total,
      COUNT(CASE WHEN s = 'UP' THEN 1 END)::int                      AS up,
      AVG(CASE WHEN s = 'UP' THEN rt END)::float8                    AS "avgRt"
    FROM (${base}) t
    GROUP BY mid
    ORDER BY total DESC
    LIMIT 5`;
}

/**
 * Daily time-series for charting (one row per UTC day).
 */
async function dailySeries(ids, from, to) {
  const base = baseRows(ids, from, to);
  return prisma.$queryRaw`
    SELECT
      date_trunc('day', at)::date                                     AS day,
      COUNT(*)::int                                                   AS total,
      COUNT(CASE WHEN s = 'UP' THEN 1 END)::int                      AS up,
      AVG(CASE WHEN s = 'UP' THEN rt END)::float8                    AS "avgRt"
    FROM (${base}) t
    GROUP BY 1
    ORDER BY 1`;
}

/**
 * Tunable 0-100 composite score.
 * Weights: 60% availability, 40% speed.
 *   Availability: 95% uptime -> 0 pts, 100% -> 100 pts (linear)
 *   Speed:        200ms avg  -> 100 pts, 2000ms -> 0 pts (linear)
 */
function performanceScore(uptime, avgRt) {
  if (uptime === null || avgRt === null) return null;
  const availability = clamp((uptime - 95) / 5, 0, 1) * 100;
  const speed        = clamp(1 - (avgRt - 200) / 1800, 0, 1) * 100;
  return Math.round(availability * 0.6 + speed * 0.4);
}

/* ------------------------------------------------------------------ */
/* Empty-group guard                                                   */
/* ------------------------------------------------------------------ */

/** Returned when a group exists but has zero results in the window. */
function emptyStats(group, now) {
  return {
    provider:        { key: group.key, name: group.name },
    generatedAt:     now.toISOString(),
    meetsMinimumData: false,
    monitors:        { total: group.monitorIds.length, active: group.activeMonitors },
    checks:          { total: 0, up: 0, down: 0, firstAt: null, lastAt: null, windowDays: 0 },
    uptime:          { percentage: null, last7Days: null, previous7Days: null, changePoints: null },
    responseTime:    { avg: null, min: null, max: null, median: null, p95: null, last7DaysAvg: null, changePercent: null },
    incidents:       { count: 0, longestUpStreakChecks: 0, longestDownStreakChecks: 0 },
    performanceScore: null,
    sites:           [],
    daily:           [],
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * List all providers currently tracked by the uptime monitor,
 * with check counts and eligibility flag (for the admin dropdown).
 */
export async function listProviders() {
  const groups = await groupMonitorsByProvider();
  if (!groups.size) return [];

  const allIds = [...groups.values()].flatMap((g) => g.monitorIds);
  if (!allIds.length) return [];

  const idList = Prisma.join(allIds.map((id) => Prisma.sql`${id}`));
  const counts = await prisma.$queryRaw`
    SELECT r."monitorId" AS mid, COUNT(*)::int AS checks
    FROM "UptimeResult" r
    WHERE r."monitorId" IN (${idList})
    GROUP BY r."monitorId"`;

  const checksByMonitor = new Map(counts.map((c) => [Number(c.mid), Number(c.checks)]));

  return [...groups.values()]
    .map((g) => {
      const totalChecks = g.monitorIds.reduce((sum, id) => sum + (checksByMonitor.get(id) ?? 0), 0);
      return {
        key:            g.key,
        name:           g.name,
        monitors:       g.monitorIds.length,
        activeMonitors: g.activeMonitors,
        totalChecks,
        eligible:       totalChecks >= MIN_CHECKS,
      };
    })
    .sort((a, b) => b.totalChecks - a.totalChecks);
}

/**
 * Full statistical profile for one provider.
 * Returns null when no monitor belongs to the provider key.
 *
 * Uses a 30-day window (matching UptimeResult retention) instead of epoch
 * so the query always hits the checkedAt index efficiently.
 */
export async function computeProviderStats(providerKey) {
  const groups = await groupMonitorsByProvider();
  const group  = groups.get(providerKey);
  if (!group) return null;

  const ids = group.monitorIds;
  if (!ids.length) return emptyStats(group, new Date());

  const now  = new Date();
  const from = new Date(now.getTime() - RETENTION_DAYS * DAY_MS); // 30-day window
  const d7   = new Date(now.getTime() - 7  * DAY_MS);
  const d14  = new Date(now.getTime() - 14 * DAY_MS);

  // All 6 queries run in parallel — each hits the (monitorId, checkedAt) index.
  const [overall, last7, prev7, streaks, perMonitor, daily] = await Promise.all([
    aggregateWindow(ids, from, now),
    aggregateWindow(ids, d7,   now),
    aggregateWindow(ids, d14,  d7),
    streakStats(ids, from, now),
    perMonitorStats(ids, from, now),
    dailySeries(ids, from, now),
  ]);

  const total       = num(overall?.total) ?? 0;
  if (total === 0)  return emptyStats(group, now);

  const uptime      = pct(num(overall?.up), total);
  const uptime7     = pct(num(last7?.up),   num(last7?.total));
  const uptimePrev7 = pct(num(prev7?.up),   num(prev7?.total));
  const avgRt       = round(overall?.avgRt);
  const avgRt7      = round(last7?.avgRt);
  const avgRtPrev7  = round(prev7?.avgRt);

  const windowDays =
    overall?.firstAt && overall?.lastAt
      ? Math.max(1, Math.ceil((new Date(overall.lastAt) - new Date(overall.firstAt)) / DAY_MS))
      : 0;

  return {
    provider:         { key: group.key, name: group.name },
    generatedAt:      now.toISOString(),
    meetsMinimumData: total >= MIN_CHECKS,
    monitors:         { total: ids.length, active: group.activeMonitors },
    checks: {
      total,
      up:       num(overall?.up)   ?? 0,
      down:     num(overall?.down) ?? 0,
      firstAt:  overall?.firstAt   ?? null,
      lastAt:   overall?.lastAt    ?? null,
      windowDays,
    },
    uptime: {
      percentage:    uptime,
      last7Days:     uptime7,
      previous7Days: uptimePrev7,
      changePoints:
        uptime7 !== null && uptimePrev7 !== null
          ? round(uptime7 - uptimePrev7, 3)
          : null,
    },
    responseTime: {
      avg:          avgRt,
      min:          round(overall?.minRt),
      max:          round(overall?.maxRt),
      median:       round(num(overall?.p50)),
      p95:          round(num(overall?.p95)),
      last7DaysAvg: avgRt7,
      // negative = got faster vs previous week
      changePercent:
        avgRt7 !== null && avgRtPrev7
          ? round(((avgRt7 - avgRtPrev7) / avgRtPrev7) * 100, 1)
          : null,
    },
    incidents: {
      count:                  num(streaks?.incidents)   ?? 0,
      longestUpStreakChecks:  num(streaks?.longestUp)   ?? 0,
      longestDownStreakChecks: num(streaks?.longestDown) ?? 0,
    },
    performanceScore: performanceScore(uptime, avgRt),
    // Customer domains are never exposed; sites are anonymised as "Site 1", "Site 2", …
    sites: (perMonitor ?? []).map((m, i) => ({
      label:           `Site ${i + 1}`,
      uptime:          pct(num(m.up), num(m.total)),
      avgResponseTime: round(m.avgRt),
      checks:          num(m.total),
    })),
    daily: (daily ?? []).map((d) => ({
      date:            new Date(d.day).toISOString().slice(0, 10),
      uptime:          pct(num(d.up), num(d.total)),
      avgResponseTime: round(d.avgRt),
      checks:          num(d.total),
    })),
  };
}
