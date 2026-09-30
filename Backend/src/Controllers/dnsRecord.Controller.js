import { DnsRecord } from "../Models/dnsRecord.Model.js";
import { dnsRecordCheck } from "../queue/dnsRecordCheck.Queue.js";
import { normalizeHostname, DnsServiceError } from "../Services/dnsRecordtype.Service.js";

export const dnsRecordLookup = async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({ success: false, error: "Missing or invalid 'url' in request body" });
    }

    let hostname;
    try {
      hostname = normalizeHostname(url);
    } catch (err) {
      const status = err instanceof DnsServiceError ? err.statusCode : 400;
      return res.status(status).json({ success: false, error: err.message });
    }

    const roomId = `user:${req.user._id}`

    const record = await DnsRecord.create({
      userId: req.user._id,
      url: hostname,
    });

    const job = await dnsRecordCheck.add("dnsRecordCheck-queue", {
      targetUrl: hostname,
      roomId,
      recordId: record._id,
    });

    if (!job) {
      await DnsRecord.findByIdAndDelete(record._id);
      return res.status(500).json({ success: false, error: "Failed to queue DNS lookup" });
    }

    return res.status(202).json({
      success: true,
      message: "DNS record lookup queued",
      jobId: job.id,
      roomId,
      data: record,
    });
  } catch (err) {
    console.error("[dnsRecordLookup]", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};
