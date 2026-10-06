import { RedirectCheck } from "../Models/redirectCheck.Model.js";
import { redirectQueue } from "../queue/redirectCheck.Queue.js";

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

    let targetUrl = url.trim();
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

    const userId = req.user._id.toString();
    const roomId = `user:${userId}`;

    // 1. Create DB record first with status 'queued'
    record = await RedirectCheck.create({
      userId,
      url: targetUrl,
      status: "queued",
    });

    const redirectCheckId = record._id.toString();

    // 2. Add job inside queue with db data inside job and set job id as db id
    const job = await redirectQueue.add(
      "redirect-queue",
      {
        targetUrl,
        userId,
        redirectCheckId,
        recordId: redirectCheckId,
        roomId,
        dbData: record.toObject ? record.toObject() : record,
      },
      {
        jobId: redirectCheckId,
      }
    );

    if (!job) {
      await RedirectCheck.findByIdAndDelete(record._id);
      return res.status(500).json({
        success: false,
        error: "Failed to queue redirect check",
      });
    }

    return res.status(202).json({
      success: true,
      message: "Redirect check queued",
      jobId: job.id,
      redirectCheckId,
      roomId,
      data: record,
    });
  } catch (err) {
    console.error("[redirectCheckController] error:", err);

    if (record?._id) {
      await RedirectCheck.findByIdAndDelete(record._id).catch(() => {});
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
    const userId = req.user._id;
    const { page = 1, limit = 20, url, status = "completed" } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const query = { userId };
    if (status) {
      query.status = status;
    }
    if (url) {
      query.url = { $regex: url.trim(), $options: "i" };
    }

    const [results, total] = await Promise.all([
      RedirectCheck.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      RedirectCheck.countDocuments(query),
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
