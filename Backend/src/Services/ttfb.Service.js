export async function measureTTFB(targetUrl, timeoutMs = 20000) {
  try {
   
    const url = new URL(targetUrl);
   
    const controller = new AbortController(); // aborting req if reaches the max timeoutms 
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const start = performance.now();

    // 3. Spoof a standard User-Agent to prevent 403 blocks from CDNs like Cloudflare
    const response = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,  // cuz of this  the controller will kill thsi req if it takes more than 20s
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
    });
    console.log("Response received:", response);

    const end = performance.now();
    clearTimeout(timeoutId); // Prevent memory leaks

    
    return {
      ttfb: Math.round(end - start),
      statusCode: response.status,
      success: response.ok
    };

  } catch (error) {
    
    if (error.name === 'AbortError') {
      return { ttfb: null, statusCode: 408, success: false, error: "Request Timeout" };
    }
    
    return { 
      ttfb: null, 
      statusCode: null, 
      success: false, 
      error: error.message || "Network Error" 
    };
  }
}