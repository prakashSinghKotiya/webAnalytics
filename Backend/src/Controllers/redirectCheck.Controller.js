import { RedirectCheck } from "../Models/redirectCheck.Model.js";
import { redirectQueue } from "../queue/redirectCheck.Queue.js";

export const redirectCheckController = async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({ success: false, error: "Missing or invalid 'url' in request body" });
    }

    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return res.status(400).json({ success: false, error: "URL must start with http:// or https://" });
      }
    } catch {
      return res.status(400).json({ success: false, error: "Invalid URL format. Include http:// or https://" });
    }

    const roomId = `user:${req.user._id}`

    const record = await RedirectCheck.create({
      userId: req.user._id,
      url: url.trim(),
    });

    const job = await redirectQueue.add("redirect-queue", {
      targetUrl: url.trim(),
      roomId,
      recordId: record._id,
    });

    if (!job) {
      await RedirectCheck.findByIdAndDelete(record._id);
      return res.status(500).json({ success: false, error: "Failed to queue redirect check" });
    }

    return res.status(202).json({
      success: true,
      message: "Redirect check queued",
      jobId: job.id,
      roomId,
      data: record,
    });
  } catch (err) {
    console.error("[redirectCheckController]", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
};
