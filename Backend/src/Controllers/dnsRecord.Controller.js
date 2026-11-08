import { prisma } from "../config/db.prismaSQL.js";
import { boss, dnsRecordQueueName } from "../queue/dnsRecordCheck.Queue.js";
import { normalizeHostname, DnsServiceError } from "../Services/dnsRecordtype.Service.js";
import { releaseGuestDemoReservation } from "../Middleware/guestDemoUsage.Mw.js";
import { resolveServiceRecord } from "../Services/jobIdResolver.Service.js";

export const dnsRecordLookup = async (req, res) => {
  let record = null;
  try {
    const rawUrl = req.body?.url;

    if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid 'url' in request body",
      });
    }

    let hostname = req.targetHostname;
    if (!hostname) {
      try {
        hostname = normalizeHostname(rawUrl);
      } catch (err) {
        const status = err instanceof DnsServiceError ? err.statusCode : 400;
        return res.status(status).json({ success: false, error: err.message });
      }
    }

    const userId = req.user?.id != null ? Number(req.user.id) : (req.user?._id != null ? Number(req.user._id) : undefined);
    const guestId = req.guestId;
    const roomId = userId ? `user:${userId}` : `guest:${guestId}`;

    // 1. Create DB record with status 'queued'
    record = await prisma.dnsRecord.create({
      data: {
        ...(userId ? { userId } : { guestId }),
        roomId,
        url: hostname,
        status: "queued",
      },
    });

    const dnsRecordId = record.id.toString();

    // 2. pg-boss generates the job id (UUID); the PostgreSQL record id travels in the job data
    const jobId = await boss.send(dnsRecordQueueName, {
      targetUrl: hostname,
      userId,
      guestId,
      dnsRecordId,
      roomId,
    });

    if (!jobId) throw new Error("Failed to enqueue DNS record check job");

    return res.status(202).json({
      success: true,
      message: "DNS record lookup started",
      jobId,
      dnsRecordId,
      roomId,
      guest: !userId,
      remaining: req.guestDemoRemaining,
      totalLimit: req.guestDemoTotalLimit,
      data: record,
    });
  } catch (err) {
    console.error("[dnsRecordLookup] error:", err);

    await releaseGuestDemoReservation(req);

    // Rollback created document if queue addition failed
    if (record?.id) {
      await prisma.dnsRecord.delete({ where: { id: record.id } }).catch(() => {});
    }

    return res.status(500).json({
      success: false,
      message: "Failed to queue DNS lookup",
      error: err.message || "Internal server error",
    });
  }
};

export const getDnsRecordResults = async (req, res) => {
  try {
    const userId = req.user?.id != null ? Number(req.user.id) : Number(req.user?._id);
    const {
      page = 1,
      limit = 20,
      url,
      status = "completed",
    } = req.query;

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
      prisma.dnsRecord.findMany({
        where: query,
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.dnsRecord.count({ where: query }),
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
  } catch (error) {
    console.error("getDnsRecordResults error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch DNS record results",
    });
  }
};

export const getDnsRecordById = async (req, res) => {
  try {
    const userId = req.user?.id != null ? Number(req.user.id) : (req.user?._id != null ? Number(req.user._id) : undefined);
    const guestId = req.guestId;
    const { id } = req.params;

    const dnsId = parseInt(id, 10);
    if (Number.isNaN(dnsId)) {
      return res.status(404).json({
        success: false,
        message: "DNS record not found",
      });
    }

    const query = { id: dnsId };
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

    const result = await prisma.dnsRecord.findFirst({
      where: query,
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "DNS record not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("getDnsRecordById error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch DNS record",
    });
  }
};

export const getDnsRecordStatus = async (req, res) => {
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
      service: "dns",
      id,
      userId,
      guestId,
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "DNS record not found",
      });
    }

    const docIdStr = doc.id.toString();
    return res.status(200).json({
      success: true,
      jobId: docIdStr,
      dnsRecordId: docIdStr,
      id: doc.id,
      status: doc.status,
      result: doc.result,
      error: doc.error || null,
      createdAt: doc.createdAt,
      completedAt: doc.completedAt || null,
    });
  } catch (error) {
    console.error("getDnsRecordStatus error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch DNS record status",
    });
  }
};
