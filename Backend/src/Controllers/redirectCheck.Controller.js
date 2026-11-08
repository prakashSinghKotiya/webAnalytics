import { prisma } from "../config/db.prismaSQL.js";
import { boss, redirectQueueName } from "../queue/redirectCheck.Queue.js";
import { releaseGuestDemoReservation } from "../Middleware/guestDemoUsage.Mw.js";
import { resolveServiceRecord } from "../Services/jobIdResolver.Service.js";

export const redirectCheckController = async (req, res) => {
  let record = null;
  try {
    const { url } = req.body;

    if (!url || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid 'url' in request body",
      });
    }

    let targetUrl = req.targetUrl;
    if (!targetUrl) {
      targetUrl = url.trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = `http://${targetUrl}`;
      }

      try {
        const parsed = new URL(targetUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          return res.status(400).json({
            success: false,
            error: "URL must start with http:// or https://",
          });
        }
        targetUrl = parsed.toString();
      } catch {
        return res.status(400).json({
          success: false,
          error: "Invalid URL format. Include http:// or https://",
        });
      }
    }

    const userId = req.user?.id != null ? Number(req.user.id) : (req.user?._id != null ? Number(req.user._id) : undefined);
    const guestId = req.guestId;
    const roomId = userId ? `user:${userId}` : `guest:${guestId}`;

    // 1. Create DB record with status 'queued'
    record = await prisma.redirectCheck.create({
      data: {
        ...(userId ? { userId } : { guestId }),
        roomId,
        url: targetUrl,
        status: "queued",
      },
    });

    const redirectCheckId = record.id.toString();

    // 2. Add job inside pg-boss queue
    const jobId = await boss.send(redirectQueueName, {
      targetUrl,
      userId,
      guestId,
      redirectCheckId,
      recordId: redirectCheckId,
      roomId,
    });

    if (!jobId) {
      throw new Error("Failed to enqueue redirect check job");
    }

    return res.status(202).json({
      success: true,
      message: "Redirect check queued",
      jobId,
      redirectCheckId,
      roomId,
      guest: !userId,
      remaining: req.guestDemoRemaining,
      totalLimit: req.guestDemoTotalLimit,
      data: record,
    });
  } catch (err) {
    console.error("[redirectCheckController] error:", err);

    await releaseGuestDemoReservation(req);

    if (record?.id) {
      await prisma.redirectCheck.delete({ where: { id: record.id } }).catch(() => {});
    }

    return res.status(500).json({
      success: false,
      message: "Failed to queue redirect check",
      error: err.message || "Internal server error",
    });
  }
};

export const getRedirectCheckResults = async (req, res) => {
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
      prisma.redirectCheck.findMany({
        where: query,
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.redirectCheck.count({ where: query }),
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
    console.error("[getRedirectCheckResults] error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch redirect check results",
      error: err.message,
    });
  }
};

export const getRedirectCheckById = async (req, res) => {
  try {
    const userId = req.user?.id != null ? Number(req.user.id) : (req.user?._id != null ? Number(req.user._id) : undefined);
    const guestId = req.guestId;
    const { id } = req.params;

    const redirectId = parseInt(id, 10);
    if (Number.isNaN(redirectId)) {
      return res.status(404).json({
        success: false,
        message: "Redirect check record not found",
      });
    }

    const query = { id: redirectId };
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

    const result = await prisma.redirectCheck.findFirst({
      where: query,
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Redirect check record not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("getRedirectCheckById error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch redirect check record",
    });
  }
};

export const getRedirectCheckStatus = async (req, res) => {
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
      service: "redirect",
      id,
      userId,
      guestId,
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Redirect check record not found",
      });
    }

    const docIdStr = doc.id.toString();
    return res.status(200).json({
      success: true,
      jobId: docIdStr,
      redirectCheckId: docIdStr,
      id: doc.id,
      status: doc.status,
      result: doc.result,
      error: doc.error || null,
      createdAt: doc.createdAt,
      completedAt: doc.completedAt || null,
    });
  } catch (error) {
    console.error("getRedirectCheckStatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch redirect check status",
    });
  }
};
