import http from "http";
import https from "https";
import dns from "dns";
export const checkUrl = (targetUrl, options = {}) => {
  const { timeout = 10000, degradedThreshold = 3000, } = options; //dest ,initializing def value if not provided

  return new Promise((resolve) => {
    

    let ttfb = null;
    let url;
    let dnstime = null
    let dnsaddress = null
    

    try {
      url = new URL(targetUrl);
    } catch {
      return resolve({
        status: "DOWN",
        reason: "INVALID_URL",
        httpStatus: null,
        responseTime: null,
        ttfb: null,
      });
    }
    const checkingFor = url.hostname

    const client = url.protocol === "https:" ? https : http;
  

    const startTime = performance.now();

    const req = client.request(
      url,
      {
        method: "GET",
        timeout,
        headers: {
          "User-Agent": "WebAppMonitor/1.0",
        },
        lookup: (hostname, options, callback) => {

          const dnsstartTime = performance.now();

          dns.lookup(hostname, options, (err, address, family) => {

            dnstime = performance.now() - dnsstartTime;
            console.log("dns lookup", hostname, address, family,options);
            if (err) {
              callback(err,address, family);
            } else {
              dnsaddress = address 
              callback(null,address, family);
              
            }
          });
        },
      },
      (res) => {
        
        ttfb = performance.now() - startTime;  // First byte received
     
        
        res.resume(); // We don't need the entire response body

        res.on("end", () => {
          const responseTime = performance.now() - startTime;

          let status;

          if (res.statusCode >= 500) {
            status = "DOWN";
          } else if (responseTime >= degradedThreshold) {
            status = "DEGRADED";
          } else if (res.statusCode >= 400) {
            status = "DOWN";
          } else if (res.statusCode >= 200 && res.statusCode < 400) {
            status = "UP";
          } else {
            status = "DOWN";
          }

          resolve({
            status,
            reason: status === "UP"
              ? "HTTP_OK"
              : status === "DEGRADED"
                ? "HIGH_RESPONSE_TIME"
                : "HTTP_ERROR",

            httpStatus: res.statusCode,

            TotalresponseTime: Math.round(responseTime),
            ttfb: Math.round(ttfb),

            DNSTime: Math.round(dnstime),
            dnsAddress: dnsaddress,
            checkingFor: checkingFor,
            timestamp: new Date().toISOString(),
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();

      resolve({
        status: "DOWN",
        reason: "TIMEOUT",

        httpStatus: null,
        responseTime: Math.round(performance.now() - startTime),
        ttfb: null,

        timestamp: new Date().toISOString(),
      });
    });

    req.on("error", (error) => {
      resolve({
        status: "DOWN",
        reason: getErrorReason(error),

        httpStatus: null,
        responseTime: Math.round(performance.now() - startTime),
        ttfb: null,

        error: error.code || error.message,

        timestamp: new Date().toISOString(),
      });
    });

    req.end();
  });
};


const getErrorReason = (error) => {
  switch (error.code) {
    case "ENOTFOUND":
      return "DNS_ERROR";

    case "ECONNREFUSED":
      return "CONNECTION_REFUSED";

    case "ECONNRESET":
      return "CONNECTION_RESET";

    case "ETIMEDOUT":
      return "CONNECTION_TIMEOUT";

    default:
      return "NETWORK_ERROR";
  }
};