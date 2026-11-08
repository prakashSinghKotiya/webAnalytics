import { prisma } from "../config/db.prismaSQL.js";
import { boss, whoisLookupQueue } from "../queue/WhoisLookup.Queue.js";
import { releaseGuestDemoReservation } from "../Middleware/guestDemoUsage.Mw.js";
import { resolveServiceRecord } from "../Services/jobIdResolver.Service.js";

export const whoisLookupController = async (req, res) => {
  let whoisDb = null;
  try {
    const { url } = req.body;

    if (!url || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid 'url' in request body",
      });
    }

    const targetUrl = req.targetUrl || url.trim();
    const userId = req.user?.id != null ? Number(req.user.id) : (req.user?._id != null ? Number(req.user._id) : undefined);
    const guestId = req.guestId;
    const roomId = userId ? `user:${userId}` : `guest:${guestId}`;

    // 1. Create DB record with status 'queued'
    whoisDb = await prisma.whoisLookup.create({
      data: {
        ...(userId ? { userId } : { guestId }),
        roomId,
        url: targetUrl,
        status: "queued",
      },
    });

    const whoisDbId = whoisDb.id.toString();

    // 2. Add job inside pg-boss queue
    const jobId = await boss.send(whoisLookupQueue, {
      targetUrl,
      userId,
      guestId,
      whoisDbId,
      recordId: whoisDbId,
      roomId,
    });

    if (!jobId) {
      throw new Error("Failed to enqueue WHOIS lookup job");
    }

    return res.status(202).json({
      success: true,
      message: "WHOIS lookup queued",
      jobId,
      whoisDbId,
      roomId,
      guest: !userId,
      remaining: req.guestDemoRemaining,
      totalLimit: req.guestDemoTotalLimit,
      data: whoisDb,
    });
  } catch (err) {
    console.error("[whoisLookupController] error:", err);

    await releaseGuestDemoReservation(req);

    if (whoisDb?.id) {
      await prisma.whoisLookup.delete({ where: { id: whoisDb.id } }).catch(() => {});
    }

    return res.status(500).json({
      success: false,
      message: "Failed to queue WHOIS lookup",
      error: err.message || "Internal server error",
    });
  }
};

export const getWhoisLookupResults = async (req, res) => {
  try {
    const userId = req.user?.id != null ? Number(req.user.id) : Number(req.user?._id);
    const { page = 1, limit = 20, url, status = "completed" } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const query = {
      userId,
      result: { not: null },
    };
    if (status) {
      query.status = status;
    }
    if (url) {
      query.url = { contains: url.trim(), mode: "insensitive" };
    }

    const [results, total] = await Promise.all([
      prisma.whoisLookup.findMany({
        where: query,
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.whoisLookup.count({ where: query }),
    ]);

    return res.status(200).json({
      success: true,
      data: results,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error("[getWhoisLookupResults] error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch WHOIS lookup results",
      error: err.message,
    });
  }
};

export const getWhoisLookupById = async (req, res) => {
  try {
    const userId = req.user?.id != null ? Number(req.user.id) : (req.user?._id != null ? Number(req.user._id) : undefined);
    const guestId = req.guestId;
    const { id } = req.params;

    const whoisId = parseInt(id, 10);
    if (Number.isNaN(whoisId)) {
      return res.status(404).json({
        success: false,
        message: "WHOIS lookup record not found",
      });
    }

    const query = { id: whoisId };
    if (userId) {
      query.userId = userId;
    } else if (guestId) {
      query.guestId = guestId;
    } else {
      return res.status(401).json({
        success: false,
        message: "Authentication or guest session required",
      });
    }

    const result = await prisma.whoisLookup.findFirst({
      where: query,
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "WHOIS lookup record not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("getWhoisLookupById error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch WHOIS record",
    });
  }
};

export const getWhoisLookupStatus = async (req, res) => {
  try {
    const userId = req.user?.id != null ? Number(req.user.id) : (req.user?._id != null ? Number(req.user._id) : undefined);
    const guestId = req.guestId;
    const { id } = req.params;

    if (!userId && !guestId) {
      return res.status(401).json({
        success: false,
        message: "Authentication or guest session required",
      });
    }

    const { doc } = await resolveServiceRecord({
      service: "whois",
      id,
      userId,
      guestId,
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "WHOIS lookup record not found",
      });
    }

    const docIdStr = doc.id.toString();
    return res.status(200).json({
      success: true,
      jobId: docIdStr,
      whoisDbId: docIdStr,
      id: doc.id,
      status: doc.status,
      result: doc.result,
      error: doc.error || null,
      createdAt: doc.createdAt,
      completedAt: doc.completedAt || null,
    });
  } catch (error) {
    console.error("getWhoisLookupStatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch WHOIS lookup status",
    });
  }
};
