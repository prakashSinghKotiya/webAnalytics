import { prisma } from "../config/db.prismaSQL.js";
import { boss, lighthouseQueueName } from "../queue/Lighthouse.queue.js";
import { normalizePublicHttpUrl } from "../Services/publicUrl.Service.js";
import { releaseGuestDemoReservation } from "../Middleware/guestDemoUsage.Mw.js";
import { resolveServiceRecord } from "../Services/jobIdResolver.Service.js";

export const LighthouseResult = async (req, res) => {
  let lighthouseDb = null;
  try {
    const { strategy: requestedStrategy = "mobile" } = req.body;
    const strategy = req.lighthouseStrategy || requestedStrategy;

    const validStrategies = ["mobile", "desktop", "both"];
    if (strategy && !validStrategies.includes(strategy)) {
      return res.status(400).json({
        success: false,
        error: `Invalid 'strategy'. Expected one of: ${validStrategies.join(", ")}`,
      });
    }

    let targetUrl;
    try {
      targetUrl = req.targetUrl || normalizePublicHttpUrl(req.body.url);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    const rawUserId = req.user?._id || req.user?.id;
    const userId = rawUserId ? Number(rawUserId) : null;
    const guestId = req.guestId;
    const roomId = userId ? `user:${userId}` : `guest:${guestId}`;

    // 1. Create DB record first with status 'queued'
    lighthouseDb = await prisma.lighthouse.create({
      data: {
        ...(userId ? { userId } : { guestId }),
        roomId,
        url: targetUrl,
        strategy,
        status: "queued",
      },
    });

    const lighthousedbId = lighthouseDb.id.toString();

    // 2. pg-boss generates the job id (UUID); the PostgreSQL record id travels in the job data
    const jobId = await boss.send(
      lighthouseQueueName,
      {
        targetUrl,
        userId: userId ? userId.toString() : undefined,
        guestId,
        lighthousedbId,
        strategy,
        roomId,
      },
      {
        expireInSeconds: 180, // PageSpeed can take 60-90s, keep above worker timeout
      }
    );

    if (!jobId) throw new Error("Failed to enqueue Lighthouse job");

    return res.status(202).json({
      success: true,
      message: "Lighthouse analysis started",
      jobId,
      lighthousedbId,
      roomId,
      data: {
        ...lighthouseDb,
        _id: lighthouseDb.id,
      },
      guest: !userId,
      remaining: userId ? undefined : req.guestDemoRemaining,
      totalLimit: userId ? undefined : req.guestDemoTotalLimit,
    });
  } catch (error) {
    console.error("LighthouseResult error:", error);
    await releaseGuestDemoReservation(req);

    if (lighthouseDb?.id) {
      await prisma.lighthouse.delete({ where: { id: lighthouseDb.id } }).catch(() => {});
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create Lighthouse job",
      error: error.message,
    });
  }
};

export const getLighthouseResults = async (req, res) => {
  try {
    const rawUserId = req.user?._id || req.user?.id;
    const userId = Number(rawUserId);
    const {
      page = 1,
      limit = 20,
      url,
      status = "completed",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = {
      userId,
      result: { not: null },
    };

    if (status) {
      where.status = status;
    }

    if (url) {
      where.url = { contains: url.trim(), mode: "insensitive" };
    }

    const [results, total] = await Promise.all([
      prisma.lighthouse.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.lighthouse.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      data: results.map((r) => ({ ...r, _id: r.id })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("getLighthouseResults error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch Lighthouse results",
    });
  }
};

export const getLighthouseById = async (req, res) => {
  try {
    const rawUserId = req.user?._id || req.user?.id;
    const userId = rawUserId ? Number(rawUserId) : null;
    const guestId = req.guestId;
    const { id } = req.params;

    const numericId = parseInt(id, 10);
    if (Number.isNaN(numericId)) {
      return res.status(404).json({
        success: false,
        message: "Lighthouse record not found",
      });
    }

    const where = { id: numericId };
    if (userId) {
      where.userId = userId;
    } else if (guestId) {
      where.guestId = guestId;
    } else {
      return res.status(401).json({
        success: false,
        message: "Authentication or guest session required",
      });
    }

    const result = await prisma.lighthouse.findFirst({ where });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Lighthouse record not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        ...result,
        _id: result.id,
      },
    });
  } catch (error) {
    console.error("getLighthouseById error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch Lighthouse record",
    });
  }
};

export const getLighthouseStatus = async (req, res) => {
  try {
    const rawUserId = req.user?._id || req.user?.id;
    const userId = rawUserId ? Number(rawUserId) : null;
    const guestId = req.guestId;
    const { id } = req.params;

    if (!userId && !guestId) {
      return res.status(401).json({
        success: false,
        message: "Authentication or guest session required",
      });
    }

    const { doc } = await resolveServiceRecord({
      service: "lighthouse",
      id,
      userId,
      guestId,
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Lighthouse record not found",
      });
    }

    const docIdStr = doc.id.toString();
    return res.status(200).json({
      success: true,
      jobId: docIdStr,
      lighthousedbId: docIdStr,
      id: doc.id,
      status: doc.status,
      strategy: doc.strategy,
      result: doc.result,
      error: doc.error || null,
      createdAt: doc.createdAt,
      completedAt: doc.completedAt || null,
    });
  } catch (error) {
    console.error("getLighthouseStatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch Lighthouse status",
    });
  }
};
