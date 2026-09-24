import {getDomain} from "tldts";

const DEFAULT_TIMEOUT = 9000;
const RDAP_BASE_URL = "https://rdap.org";

export async function checkRDAPLookup(targetUrl, options = {}) {
    const { timeout = DEFAULT_TIMEOUT} = options;

    let parsedUrl;

    try {

if (typeof targetUrl !== "string" || !targetUrl.trim()) {
        throw new Error("EMPTY_OR_NON_STRING");
    }

    let input = targetUrl.trim();

    // Fix protocol-relative URLs (e.g., //example.com -> example.com)
    input = input.replace(/^\/\//, "");

    // Add https:// if no scheme like http:// or custom:// is present
    const normalizedUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
        ? input
        : `https://${input}`;


        parsedUrl = new URL(normalizedUrl);
    } catch {
        return {
            success: false,
            error: {
                code: "INVALID_URL",
                message: "Invalid URL",
            },
        };
    }

    const hostname = parsedUrl.hostname.toLowerCase();

   
    const domain = getDomain(hostname);  

    if (!domain) {
        return {
            success: false,
            error: {
                code: "INVALID_DOMAIN",
                message: `Could not determine registrable domain from hostname: ${hostname}`,
            },
        };
    }

   
    const lookupData = await rdapLookup(domain, {
        timeout,
    });

    return lookupData
}


async function rdapLookup(domain, options = {}) {
    const {
        timeout = DEFAULT_TIMEOUT,
    } = options;

    const endpoint = `${RDAP_BASE_URL}/domain/${encodeURIComponent(domain)}`;

    try {
        const response = await fetch(endpoint, {
            method: "GET",

            headers: {
                Accept: "application/rdap+json",
                "User-Agent": "SpeedMonitor/1.0",
            },

            redirect: "follow",

            signal: AbortSignal.timeout(timeout),
        });

     
        if (!response.ok) {
            return {
                success: false,
                domain,

                error: {
                    code: getRDAPErrorCode(response.status),
                    message: `RDAP lookup failed with HTTP ${response.status}`,
                    status: response.status,
                },
            };
        }

        
        let data;

        try {
            data = await response.json();
        } catch {
            return {
                success: false,
                domain,

                error: {
                    code: "INVALID_RDAP_RESPONSE",
                    message: "RDAP server returned invalid JSON",
                },
            };
        }

         const result = {
            success: true,
            domain: data.ldhName ?? domain,

            events: Array.isArray(data.events)
                ? data.events
                : [],

            nameservers: Array.isArray(data.nameservers)
                ? data.nameservers
                : [],

            secureDNS: data.secureDNS ?? null,
        };

     
        return result

    } catch (error) {


        if (error?.name === "TimeoutError") {
            return {
                success: false,
                domain,

                error: {
                    code: "RDAP_TIMEOUT",
                    message: `RDAP lookup timed out after ${timeout}ms`,
                },
            };
        }

        // AbortError can happen with some fetch implementations
        if (error?.name === "AbortError") {
            return {
                success: false,
                domain,

                error: {
                    code: "RDAP_ABORTED",
                    message: "RDAP lookup was aborted",
                },
            };
        }

       
        return {
            success: false,
            domain,

            error: {
                code: "RDAP_NETWORK_ERROR",
                message: "Failed to connect to RDAP service",
            },

            details: error.message
                   
        };
    }
}



