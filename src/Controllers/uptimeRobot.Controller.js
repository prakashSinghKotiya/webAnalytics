import { checkUrl } from "../Services/uptimeChecker.Service.js";


export const testUptime = async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        error: "URL is required",
      });
    }

    const result = await checkUrl(url);

    return res.json(result);

  } catch (error) {
    return res.status(500).json({
      error: "Uptime check failed",
    });
  }
};