import { z } from 'zod';
import { Prisma } from '@prisma/client';

import { computeProviderStats, listProviders, MIN_CHECKS } from '../Services/Hostingreview.Service.js';
import { prisma } from '../config/db.prismaSQL.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200);

const sendError = (res, status, message, details) =>
  res.status(status).json({ success: false, message, ...(details ? { details } : {}) });

/**
 * Handles known Prisma errors and sends the appropriate HTTP response.
 * Returns true if the error was handled, false otherwise.
 */
function handlePrismaError(err, res) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      sendError(res, 409, 'A review for this provider already exists');
      return true;
    }
    if (err.code === 'P2025') {
      sendError(res, 404, 'Review not found');
      return true;
    }
  }
  return false;
}

/**
 * Wraps an async route handler with unified error handling.
 * Prisma known errors are handled inline; unknown errors are forwarded to Express.
 */
const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (handlePrismaError(err, res)) return;
    console.error('[HostingReview]', err);
    next(err);
  }
};

const parseId = (raw) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/* ------------------------------------------------------------------ */
/* Zod validation schemas                                              */
/* ------------------------------------------------------------------ */

/**
 * editorial: all fields that an admin can write/edit.
 * providerKey is intentionally excluded — it is derived from live monitor data,
 * not supplied by the admin on updates.
 */
const editorial = z.object({
  title:       z.string().trim().min(5).max(200),
  reviewText:  z.string().trim().min(50).max(50_000),
  providerName: z.string().trim().min(1).max(255),
  rating:      z.number().min(0).max(5),
  pros:        z.array(z.string().trim().min(1).max(300)).max(15),
  cons:        z.array(z.string().trim().min(1).max(300)).max(15),
  extra:       z.record(z.string(), z.unknown()),
});

/**
 * createSchema: title + reviewText are required; providerKey is required to
 * identify which provider's stats to pull. Everything else is optional.
 */
const createSchema = z.object({
  title:        z.string().trim().min(5).max(200),
  reviewText:   z.string().trim().min(50).max(50_000),
  providerKey:  z.string().trim().min(1).max(255),
  providerName: z.string().trim().min(1).max(255).optional(),
  rating:       z.number().min(0).max(5).optional(),
  pros:         z.array(z.string().trim().min(1).max(300)).max(15).optional(),
  cons:         z.array(z.string().trim().min(1).max(300)).max(15).optional(),
  extra:        z.record(z.string(), z.unknown()).optional(),
});

/**
 * updateSchema: all editorial fields are optional; strict() rejects unknown keys
 * so the client cannot inject providerKey, stats, adminId, etc.
 */
const updateSchema = editorial.partial().strict();

const validate = (schema, body, res) => {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  sendError(res, 400, 'Validation failed',
    parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return null;
};

/* ------------------------------------------------------------------ */
/* In-memory TTL cache for public live stats (5-minute window)        */
/* ------------------------------------------------------------------ */

const STATS_TTL_MS = 5 * 60 * 1000;
const statsCache   = new Map();

async function cachedLiveStats(providerKey) {
  const hit = statsCache.get(providerKey);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await computeProviderStats(providerKey);
  statsCache.set(providerKey, { value, expires: Date.now() + STATS_TTL_MS });
  return value;
}

/** Extracts the key headline numbers for the public listing page. */
const headline = (stats) =>
  stats && {
    uptime:           stats.uptime?.percentage      ?? null,
    avgResponseTime:  stats.responseTime?.avg        ?? null,
    performanceScore: stats.performanceScore         ?? null,
    totalChecks:      stats.checks?.total            ?? 0,
  };

/* ------------------------------------------------------------------ */
/* ADMIN routes                                                        */
/* ------------------------------------------------------------------ */

/**
 * GET /review/admin/providers
 * Lists all providers currently tracked by uptime monitors, with check counts,
 * eligibility flag, and whether a review already exists for each.
 */
export const getAvailableProviders = wrap(async (_req, res) => {
  const [providers, reviews] = await Promise.all([
    listProviders(),
    prisma.hostingReview.findMany({
      select: { id: true, providerKey: true, isPublished: true },
    }),
  ]);
  const byKey = new Map(reviews.map((r) => [r.providerKey, r]));
  res.json({
    success:   true,
    minChecks: MIN_CHECKS,
    data:      providers.map((p) => ({ ...p, review: byKey.get(p.key) ?? null })),
  });
});

/**
 * GET /review/admin/providers/:providerKey/stats
 * Live stats preview while the admin is writing a review.
 */
export const previewProviderStats = wrap(async (req, res) => {
  const stats = await computeProviderStats(req.params.providerKey);
  if (!stats) return sendError(res, 404, 'No monitors found for this provider');
  res.json({ success: true, data: stats });
});

/**
 * GET /review/admin/all
 * All reviews (published and draft) for the admin dashboard.
 */
export const getAllReviewsAdmin = wrap(async (_req, res) => {
  const reviews = await prisma.hostingReview.findMany({
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true, providerKey: true, providerName: true, slug: true,
      title: true, rating: true, isPublished: true, publishedAt: true,
      statsUpdatedAt: true, updatedAt: true,
    },
  });
  res.json({ success: true, data: reviews });
});

/**
 * GET /review/admin/:id
 * Full review record including stats snapshot (admin view).
 */
export const getReviewByIdAdmin = wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return sendError(res, 400, 'Invalid id');
  const review = await prisma.hostingReview.findUnique({ where: { id } });
  if (!review) return sendError(res, 404, 'Review not found');
  res.json({ success: true, data: review });
});

/**
 * POST /review/admin/create
 * Admin writes the editorial content; backend auto-computes and attaches stats.
 *
 * Requires providerKey (the normalised key from the providers list).
 * Rejects if the provider has fewer than MIN_CHECKS results.
 */
export const createReview = wrap(async (req, res) => {
  const body = validate(createSchema, req.body, res);
  if (!body) return;

  const stats = await computeProviderStats(body.providerKey);
  if (!stats) return sendError(res, 404, 'No monitors found for this provider');
  if (!stats.meetsMinimumData) {
    return sendError(
      res, 422,
      `Not enough monitoring data yet (${stats.checks.total}/${MIN_CHECKS} checks required)`,
    );
  }

  // req.user.id is an integer set by checkAuth from session.user (Prisma User model).
  const adminId      = req.user.id;
  const providerName = body.providerName ?? stats.provider.name;

  const review = await prisma.hostingReview.create({
    data: {
      providerKey:    stats.provider.key,
      providerName,
      slug:           slugify(`${providerName}-review`),
      title:          body.title,
      reviewText:     body.reviewText,
      rating:         body.rating    ?? null,
      pros:           body.pros      ?? [],
      cons:           body.cons      ?? [],
      extra:          body.extra     ?? {},   // Prisma Json field rejects undefined
      stats,
      statsUpdatedAt: new Date(),
      adminId,
    },
  });

  res.status(201).json({ success: true, data: review });
});

/**
 * PUT /review/admin/:id
 * Update editorial fields only. Stats are never updated here — use refresh-stats.
 * updateSchema.strict() prevents injecting providerKey, stats, adminId, etc.
 */
export const updateReview = wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return sendError(res, 400, 'Invalid id');

  const body = validate(updateSchema, req.body, res);
  if (!body) return;
  if (!Object.keys(body).length) return sendError(res, 400, 'Nothing to update');

  const data = { ...body };
  // Regenerate slug if the display name changed.
  if (body.providerName) data.slug = slugify(`${body.providerName}-review`);

  const review = await prisma.hostingReview.update({ where: { id }, data });
  res.json({ success: true, data: review });
});

/**
 * POST /review/admin/:id/refresh-stats
 * Re-runs the stats computation and overwrites the stored snapshot.
 * Also invalidates the in-memory cache for this provider.
 */
export const refreshReviewStats = wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return sendError(res, 400, 'Invalid id');

  const existing = await prisma.hostingReview.findUnique({
    where:  { id },
    select: { providerKey: true },
  });
  if (!existing) return sendError(res, 404, 'Review not found');

  const stats = await computeProviderStats(existing.providerKey);
  if (!stats || stats.checks.total === 0) {
    return sendError(res, 409, 'No live monitoring data available; existing snapshot was kept');
  }

  const review = await prisma.hostingReview.update({
    where: { id },
    data:  { stats, statsUpdatedAt: new Date() },
  });

  statsCache.delete(existing.providerKey);
  res.json({ success: true, data: review });
});

/**
 * PATCH /review/admin/:id/publish
 * Toggle published state. On publish, freezes the latest stats into the snapshot.
 * Body: { published: boolean }
 */
export const setPublished = wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return sendError(res, 400, 'Invalid id');

  const parsed = z.object({ published: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, '`published` (boolean) is required');

  const existing = await prisma.hostingReview.findUnique({
    where:  { id },
    select: { providerKey: true, publishedAt: true },
  });
  if (!existing) return sendError(res, 404, 'Review not found');

  const data = { isPublished: parsed.data.published };

  if (parsed.data.published) {
    // Set publishedAt only on first publish; preserve original date on re-publish.
    data.publishedAt = existing.publishedAt ?? new Date();
    // Freeze the freshest numbers at publish time.
    // If live data is gone (e.g. monitor deleted), keep the existing snapshot.
    const stats = await computeProviderStats(existing.providerKey);
    if (stats && stats.checks.total > 0) {
      data.stats          = stats;
      data.statsUpdatedAt = new Date();
    }
  }

  const review = await prisma.hostingReview.update({ where: { id }, data });
  res.json({ success: true, data: review });
});

/**
 * DELETE /review/admin/:id
 * Permanently removes a review.
 */
export const deleteReview = wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return sendError(res, 400, 'Invalid id');
  await prisma.hostingReview.delete({ where: { id } });
  res.json({ success: true, message: 'Review deleted' });
});

/* ------------------------------------------------------------------ */
/* PUBLIC routes                                                       */
/* ------------------------------------------------------------------ */

/**
 * GET /review
 * Public listing of all published reviews.
 * Returns only headline stats (not the full stats blob) to keep the payload small.
 */
export const getAllReviews = wrap(async (_req, res) => {
  const reviews = await prisma.hostingReview.findMany({
    where:   { isPublished: true },
    orderBy: { publishedAt: 'desc' },
    select: {
      slug: true, providerName: true, title: true, rating: true,
      publishedAt: true, stats: true, extra: true,
    },
  });

  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    success: true,
    data:    reviews.map(({ stats, ...r }) => ({ ...r, headline: headline(stats) })),
  });
});

/**
 * GET /review/:slug
 * Full public review page.
 *
 * Stats strategy:
 *  - Try to serve live stats (cached 5 min) so numbers stay fresh.
 *  - Fall back to the frozen snapshot if live data is unavailable
 *    (e.g. monitor deleted, provider no longer tracked).
 *  - adminId is stripped from the public response.
 *  - snapshot is NOT sent separately — the frontend always reads `stats`.
 */
export const getReviewBySlug = wrap(async (req, res) => {
  const review = await prisma.hostingReview.findFirst({
    where: { slug: req.params.slug, isPublished: true },
  });
  if (!review) return sendError(res, 404, 'Review not found');

  let live = null;
  try {
    live = await cachedLiveStats(review.providerKey);
  } catch (err) {
    console.error('[HostingReview] live stats failed, falling back to snapshot:', err.message);
  }

  const useLive = live && live.checks.total > 0;

  // Strip internal fields before sending to public.
  const { adminId, stats: snapshot, ...publicReview } = review;

  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    success: true,
    data: {
      ...publicReview,
      stats:       useLive ? live : snapshot,
      statsSource: useLive ? 'live' : 'snapshot',
    },
  });
});
