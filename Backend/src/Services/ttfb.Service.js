import { normalizePublicHttpUrl } from "./publicUrl.Service.js";

export async function measureTTFB(targetUrl, timeoutMs = 20000) {
  try {
    let normalized = String(targetUrl || "").trim();
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = `https://${normalized}`;
    }

    // Queue payloads are normally created by the validated HTTP endpoint.
    // Re-check here because this worker performs the outbound network request.
    normalized = normalizePublicHttpUrl(normalized);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const start = performance.now();

    const response = await fetch(normalized, {
      method: "GET",
      // Following an unvalidated redirect could turn a public URL into an SSRF
      // request. TTFB is still measured accurately for the initial response.
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const end = performance.now();
    clearTimeout(timeoutId);

    // Cancel the body so the socket closes cleanly instead of hanging open
    response.body?.cancel().catch(() => {});

    return {
      ttfb: Math.round(end - start),
      statusCode: response.status,
      success: true,
      ok: response.ok,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ttfb: null, statusCode: 408, success: false, error: "Request Timeout" };
    }

    return {
      ttfb: null,
      statusCode: null,
      success: false,
      error: error.message || "Network Error",
    };
  }
}
