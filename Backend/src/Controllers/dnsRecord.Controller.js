import { DnsRecord } from "../Models/dnsRecord.Model.js";
import { dnsRecordCheck } from "../queue/dnsRecordCheck.Queue.js";
import { normalizeHostname, DnsServiceError } from "../Services/dnsRecordtype.Service.js";

export const dnsRecordLookup = async (req, res) => {
  let record = null
  try {
    const { url } = req.body;

    if (!url || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid 'url' in request body",
      });
    }

    let hostname;
    try {
      hostname = normalizeHostname(url);
    } catch (err) {
      const status = err instanceof DnsServiceError ? err.statusCode : 400;
      return res.status(status).json({ success: false, error: err.message });
    }

    const userId = req.user._id.toString();
    const roomId = `user:${userId}`;

    // 1. Create DB record first with status 'queued'
     record = await DnsRecord.create({
      userId,
      url: hostname,
      status: "queued",
    });

    const dnsRecordId = record._id.toString();

    // 2. Using  MongoDB document ID as BullMQ job ID
    const job = await dnsRecordCheck.add(
      "check-dns-records",
      {
        targetUrl: hostname,
        userId,
        dnsRecordId,
        roomId,
      },
      {
        jobId: dnsRecordId,
      }
    );

    return res.status(202).json({
      success: true,
      message: "DNS record lookup started",
      jobId: job.id,
      dnsRecordId,
      roomId,
      data: record,
    });
  } catch (err) {
    console.error("[dnsRecordLookup] error:", err);

    // Rollback created document if queue addition failed
    if (record?._id) {
      await DnsRecord.findByIdAndDelete(record._id).catch(() => {});
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
      DnsRecord.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      DnsRecord.countDocuments(query),
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
    const userId = req.user._id;
    const { id } = req.params;

    const result = await DnsRecord.findOne({
      _id: id,
      userId,
    }).lean();

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
