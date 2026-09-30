import { WhoisLookup } from "../Models/whoisLookup.Model.js";
import { whoisLookup } from "../queue/WhoisLookup.Queue.js";

export const whoisLookupController = async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({ success: false, error: "Missing or invalid 'url' in request body" });
    }

    const roomId = `user:${req.user._id}`

    const record = await WhoisLookup.create({
      userId: req.user._id,
      url: url.trim(),
    });

    const job = await whoisLookup.add("whoisLookup-queue", {
      targetUrl: url.trim(),
      roomId,
      recordId: record._id,
    });

    if (!job) {
      await WhoisLookup.findByIdAndDelete(record._id);
      return res.status(500).json({ success: false, error: "Failed to queue WHOIS lookup" });
    }

    return res.status(202).json({
      success: true,
      message: "WHOIS lookup queued",
      jobId: job.id,
      roomId,
      data: record,
    });
  } catch (err) {
    console.error("[whoisLookupController]", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};
