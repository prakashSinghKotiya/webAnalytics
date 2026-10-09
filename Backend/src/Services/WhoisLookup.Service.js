import {getDomain} from "tldts";

const DEFAULT_TIMEOUT = 9000;
const RDAP_BASE_URL = process.env.RDAP_URL

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

         const entities = Array.isArray(data.entities) ? data.entities : [];
         const result = {
            success: true,
            domain: data.ldhName ?? domain,
            events: Array.isArray(data.events) ? data.events : [],
            nameservers: Array.isArray(data.nameservers) ? data.nameservers : [],
            secureDNS: data.secureDNS ?? null,
            unicodeDomain: data.unicodeName ?? null,
            status: Array.isArray(data.status) ? data.status : [],
            registrar: findEntityByRole(entities, "registrar"),
            contacts: {
                registrant: findEntityByRole(entities, "registrant"),
                administrative: findEntityByRole(entities, "administrative"),
                technical: findEntityByRole(entities, "technical"),
                abuse: findEntityByRole(entities, "abuse"),
                billing: findEntityByRole(entities, "billing"),
            },
            entities: entities.map(normalizeEntity),
            notices: Array.isArray(data.notices) ? data.notices : [],
        };

        return result;

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
            details: error.message,
        };
    }
}

function findEntityByRole(entities, role) {
  for (const item of entities) {
    if (Array.isArray(item?.roles) && item.roles.includes(role)) {
      return normalizeEntity(item);
    }
    if (Array.isArray(item?.entities)) {
      const nested = item.entities.find((sub) => Array.isArray(sub?.roles) && sub.roles.includes(role));
      if (nested) return normalizeEntity(nested);
    }
  }
  return null;
}

function normalizeEntity(entity) {
  const fields = readVCardFields(entity?.vcardArray);
  const links = Array.isArray(entity?.links)
    ? entity.links.map((link) => ({
        href: link?.href ?? null,
        rel: link?.rel ?? null,
        type: link?.type ?? null,
        value: link?.value ?? null,
      }))
    : [];
  const contactUrl =
    links.find((l) => l.href && (l.rel === 'contact' || String(l.href).includes('contact') || String(l.href).includes('whois')))?.href ||
    links.find((l) => l.href && (l.rel === 'related' || l.type === 'text/html'))?.href ||
    links[0]?.href ||
    null;

  return {
    handle: entity?.handle ?? null,
    roles: Array.isArray(entity?.roles) ? entity.roles : [],
    name: fields.name,
    organization: fields.organization,
    address: fields.address,
    phone: fields.phone,
    email: fields.email,
    contactUrl,
    format: entity?.vcardArray ? "jCard" : null,
    events: Array.isArray(entity?.events) ? entity.events : [],
    publicIds: Array.isArray(entity?.publicIds)
      ? entity.publicIds.map((item) => ({ type: item?.type ?? null, identifier: item?.identifier ?? null }))
      : [],
    links,
  };
}

function readVCardFields(vcardArray) {
  const fields = { name: null, organization: null, address: null, phone: null, email: null };
  if (!Array.isArray(vcardArray) || !Array.isArray(vcardArray[1])) return fields;
  for (const property of vcardArray[1]) {
    if (!Array.isArray(property) || property.length < 4) continue;
    const [propertyName, , , rawValue] = property;
    const value = Array.isArray(rawValue) ? rawValue.filter(Boolean).join(", ") : rawValue;
    if (typeof value !== "string" || !value.trim()) continue;
    switch (propertyName) {
      case "fn": fields.name = value; break;
      case "org": fields.organization = value; break;
      case "adr": fields.address = parseAddress(rawValue); break;
      case "tel": fields.phone ??= value; break;
      case "email": fields.email ??= value; break;
      default: break;
    }
  }
  return fields;
}

function parseAddress(rawValue) {
  if (!Array.isArray(rawValue)) return rawValue;
  const [poBox, extended, street, locality, region, postalCode, country] = rawValue;
  return { poBox: poBox || null, extended: extended || null, street: street || null, locality: locality || null, region: region || null, postalCode: postalCode || null, country: country || null };
}




