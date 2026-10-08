import { Lighthouse } from "../Models/Lighthouse.Model.js";
import { Lighthouequeue } from "../queue/Lighthouse.queue.js";
import { normalizePublicHttpUrl } from "../Services/publicUrl.Service.js";
import { releaseGuestDemoReservation } from "../Middleware/guestDemoUsage.Mw.js";


export const LighthouseResult = async (req, res) => {
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

    const userId = req.user?._id?.toString();
    const guestId = req.guestId;
    const roomId = userId ? `user:${userId}` : `guest:${guestId}`;

    // 1. Create DB record first with status 'queued'
    const lighthouseDb = await Lighthouse.create({
      ...(userId ? { userId } : { guestId }),
      roomId,
      url: targetUrl,
      strategy,
      status: "queued",
    });

    const lighthousedbId = lighthouseDb._id.toString();

    // 2. Use MongoDB document ID as BullMQ job ID
    const job = await Lighthouequeue.add(
      "measure-lighthouse",
      {
        targetUrl,
        userId,
        guestId,
        lighthousedbId,
        strategy,
        roomId,
      },
      {
        jobId: lighthousedbId,
      }
    );

    return res.status(202).json({
      success: true,
      message: "Lighthouse analysis started",
      jobId: job.id,
      lighthousedbId,
      roomId,
      data: lighthouseDb,
      guest: !userId,
      remaining: userId ? undefined : req.guestDemoRemaining,
      totalLimit: userId ? undefined : req.guestDemoTotalLimit,
    });
  } catch (error) {
    console.error("LighthouseResult error:", error);
    await releaseGuestDemoReservation(req);
    return res.status(500).json({
      success: false,
      message: "Failed to create Lighthouse job",
      error: error.message,
    });
  }
};




export const getLighthouseResults = async (req, res) => {
  try {
    const userId = req.user._id;
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
      result: { $ne: null },
    };

    if (status) {
      query.status = status;
    }

    if (url) {
      query.url = { $regex: url.trim(), $options: "i" };
    }

    const [results, total] = await Promise.all([
      Lighthouse.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Lighthouse.countDocuments(query),
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
    console.error("getLighthouseResults error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch Lighthouse results",
    });
  }
};



export const getLighthouseById = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const result = await Lighthouse.findOne({
      _id: id,
      userId,
    }).lean();

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Lighthouse record not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("getLighthouseById error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch Lighthouse record",
    });
  }
};
