import { Ttfb } from "../Models/Ttfb.Model.js";
import { europeTtfbQueue, indiaTtfbQueue, usaTtfbQueue } from "../queue/ttfb.queue.js";

const queue = {
  india: indiaTtfbQueue,
  europe: europeTtfbQueue,
  usa: usaTtfbQueue,
};

export const ttfbFinder = async (req, res) => {
  try {
    const { url, region } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Missing 'url' in request body",
      });
    }

    const workerQueue = queue[region];
    if (!workerQueue) {
      return res.status(400).json({
        success: false,
        error: `Invalid 'region'. Expected one of: ${Object.keys(queue).join(", ")}`,
      });
    }

    const userId = req.user._id.toString();
    const roomId = `user:${userId}`;

    // Create DB record first with status 'queued'
    const ttfbDb = await Ttfb.create({
      userId,
      url,
      region,
      status: "queued",
    });

    const ttfbdbId = ttfbDb._id.toString();

    // Use MongoDB document ID as BullMQ job ID
    const job = await workerQueue.add(
      "measure-ttfb",
      {
        targetUrl: url,
        userId,
        ttfbdbId,
        region,
      },
      {
        jobId: ttfbdbId,
      }
    );

    return res.status(202).json({
      success: true,
      message: "TTFB analysis started",
      jobId: job.id,
      ttfbdbId,
      region,
      roomId,
    });
  } catch (error) {
    console.error("ttfbFinder error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create TTFB job",
    });
  }
};

export const allRegionttfbFinder = async (req, res) => {
  try {
    const { url, region } = req.body;

    // Basic validation
    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Missing 'url' in request body",
      });
    }

    if (region !== "All") {
      return res.status(400).json({
        success: false,
        error: "Invalid 'region'. Expected 'All'",
      });
    }

    const userId = req.user._id.toString();
    const roomId = `user:${userId}`;
    const regionNames = Object.keys(queue);

    // 1. Batch insert DB documents using insertMany in a single round-trip
    const docsToInsert = regionNames.map((regionName) => ({
      userId,
      url,
      region: regionName,
      status: "queued",
    }));

    const insertedDocs = await Ttfb.insertMany(docsToInsert);

    // 2. Add jobs concurrently to each respective regional queue sharing the redis connection
    const jobs = await Promise.all(
      insertedDocs.map(async (doc) => {
        const ttfbdbId = doc._id.toString();
        const regionName = doc.region;
        const workerQueue = queue[regionName];

        const job = await workerQueue.add(
          "measure-ttfb-all",
          {
            targetUrl: url,
            userId,
            ttfbdbId,
            region: regionName,
          },
          {
            jobId: ttfbdbId,
          }
        );

        return {
          jobId: job.id,
          ttfbdbId,
          region: regionName,
        };
      })
    );

    return res.status(202).json({
      success: true,
      message: "TTFB analysis started",
      region: "All",
      roomId,
      jobs,
    });
  } catch (error) {
    console.error("allRegionttfbFinder error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create TTFB jobs",
    });
  }
};

/**
 * Get TTFB records for the authenticated user that have results.
 * Supports query params: page, limit, url, region, status.
 */
export const getTtfbResults = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      page = 1,
      limit = 20,
      url,
      region,
      status = "completed",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Filter by user and ensure result exists
    const query = {
      userId,
      result: { $ne: null },
    };

    if (status) {
      query.status = status;
    }

    if (region) {
      query.region = region;
    }

    if (url) {
      query.url = { $regex: url.trim(), $options: "i" };
    }

    const [results, total] = await Promise.all([
      Ttfb.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Ttfb.countDocuments(query),
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
    console.error("getTtfbResults error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch TTFB results",
    });
  }
};



export const getTtfbById = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const result = await Ttfb.findOne({
      _id: id,
      userId,
    }).lean();

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "TTFB record not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("getTtfbById error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch TTFB record",
    });
  }
};