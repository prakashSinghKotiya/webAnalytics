import { WhoisLookup } from "../Models/whoisLookup.Model.js";
import { whoisLookup } from "../queue/WhoisLookup.Queue.js";

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

    const targetUrl = url.trim();
    const userId = req.user._id.toString();
    const roomId = `user:${userId}`;

    // 1. Create DB record first with status 'queued'
    whoisDb = await WhoisLookup.create({
      userId,
      url: targetUrl,
      status: "queued",
    });

    const whoisDbId = whoisDb._id.toString();

    // 2. Add job inside queue with db data inside job and set job id as db id
    const job = await whoisLookup.add(
      "whoisLookup-queue",
      {
        targetUrl,
        userId,
        whoisDbId,
        recordId: whoisDbId,
        roomId,
        dbData: whoisDb.toObject ? whoisDb.toObject() : whoisDb,
      },
      {
        jobId: whoisDbId,
      }
    );

    if (!job) {
      await WhoisLookup.findByIdAndDelete(whoisDb._id);
      return res.status(500).json({
        success: false,
        error: "Failed to queue WHOIS lookup",
      });
    }

    return res.status(202).json({
      success: true,
      message: "WHOIS lookup queued",
      jobId: job.id,
      whoisDbId,
      roomId,
      data: whoisDb,
    });
  } catch (err) {
    console.error("[whoisLookupController] error:", err);

    if (whoisDb?._id) {
      await WhoisLookup.findByIdAndDelete(whoisDb._id).catch(() => {});
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
      WhoisLookup.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      WhoisLookup.countDocuments(query),
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
