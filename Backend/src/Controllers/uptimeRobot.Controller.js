import { prisma } from "../config/db.prismaSQL.js";
import {
    createUptimeScheduler,
    updateUptimeScheduler,
    removeUptimeScheduler
} from "../Services/uptimeScheduler.Service.js";

import dns from "node:dns/promises";
import net from "node:net";

const resolver = new dns.Resolver({ timeout: 3000, tries: 2 });

const NOT_FOUND = "Not Found";
const orgCache = new Map(); // ASN -> { value, expires }
const ORG_TTL_MS = 6 * 60 * 60 * 1000;

const expandIpv6 = (ip) => {
    ip = ip.split("%")[0]; // strip zone id

    // Convert trailing IPv4 (::ffff:1.2.3.4) into two hex groups
    const v4 = ip.match(/(\d+\.\d+\.\d+\.\d+)$/);
    if (v4) {
        const [a, b, c, d] = v4[1].split(".").map(Number);
        const hex = (n) => n.toString(16).padStart(2, "0");
        ip = ip.replace(v4[1], `${hex(a)}${hex(b)}:${hex(c)}${hex(d)}`);
    }

    const [head, tail] = ip.split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    const fill = ip.includes("::") ? Array(8 - left.length - right.length).fill("0") : [];

    return [...left, ...fill, ...right].map((g) => g.padStart(4, "0")).join("");
};

const reverseIpv6ForDns = (ip) => expandIpv6(ip).split("").reverse().join(".");

const isPublicIp = (ip) => {
    const bl = new net.BlockList();
    ["10.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
     "192.168.0.0/16", "100.64.0.0/10", "0.0.0.0/8"].forEach((r) => {
        const [addr, bits] = r.split("/");
        bl.addSubnet(addr, Number(bits), "ipv4");
    });
    bl.addAddress("::1", "ipv6");
    bl.addSubnet("fc00::", 7, "ipv6");
    bl.addSubnet("fe80::", 10, "ipv6");
    return !bl.check(ip, net.isIPv6(ip) ? "ipv6" : "ipv4");
};

const resolveIp = async (hostname) => {
    if (net.isIP(hostname)) return { ip: hostname, family: net.isIPv6(hostname) ? 6 : 4 };

    // Race both families; prefer IPv4 if it succeeds
    const [v4, v6] = await Promise.allSettled([
        resolver.resolve4(hostname),
        resolver.resolve6(hostname),
    ]);
    if (v4.status === "fulfilled" && v4.value[0]) return { ip: v4.value[0], family: 4 };
    if (v6.status === "fulfilled" && v6.value[0]) return { ip: v6.value[0], family: 6 };
    return null;
};

const getOrgName = async (asn) => {
    const cached = orgCache.get(asn);
    if (cached && cached.expires > Date.now()) return cached.value;

    const records = await resolver.resolveTxt(`AS${asn}.asn.cymru.com`);
    // Format: "ASN | CC | registry | allocated | AS Name, CC"
    const raw = records[0].join("").split("|").pop()?.trim() || "";
    const value = raw.replace(/,\s*[A-Z]{2}$/, "").trim() || NOT_FOUND;

    orgCache.set(asn, { value, expires: Date.now() + ORG_TTL_MS });
    return value;
};

export const getDomainHostingInfo = async (hostname) => {
    const result = {
        ip: null,
        ipVersion: null,
        hostedBy: NOT_FOUND,
        asn: NOT_FOUND,
        registryCountry: NOT_FOUND,
    };

    try {
        const resolved = await resolveIp(hostname);
        if (!resolved) return result;

        result.ip = resolved.ip;
        result.ipVersion = `IPv${resolved.family}`;

        // Keep the IP even if everything below fails
        if (!isPublicIp(resolved.ip)) return result;

        const query =
            resolved.family === 4
                ? `${resolved.ip.split(".").reverse().join(".")}.origin.asn.cymru.com`
                : `${reverseIpv6ForDns(resolved.ip)}.origin6.asn.cymru.com`;

        const originRecords = await resolver.resolveTxt(query);
        const [rawAsn, , country] = originRecords[0].join("").split("|").map((s) => s.trim());
        const asnNumber = rawAsn?.split(" ")[0];
        if (!asnNumber) return result;

        result.asn = `AS${asnNumber}`;
        result.registryCountry = country || NOT_FOUND;
        result.hostedBy = await getOrgName(asnNumber);
    } catch (err) {
        console.warn(`[HostingLookup] ${hostname}:`, err.code || err.message);
    }

    return result; // partial data preserved
};

const ALLOWED_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "m1", "m5", "m15", "m30", "h1"]);
const ALLOWED_STATUSES = new Set(["active", "paused"]);

const INTERVAL_TO_PRISMA = {
    "1m": "m1",
    "5m": "m5",
    "10m": "m15",
    "15m": "m15",
    "30m": "m30",
    "1h": "h1",
    m1: "m1",
    m5: "m5",
    m10: "m15",
    m15: "m15",
    m30: "m30",
    h1: "h1",
};

const PRISMA_TO_INTERVAL = {
    m1: "1m",
    m5: "5m",
    m10: "15m",
    m15: "15m",
    m30: "30m",
    h1: "1h",
    "1m": "1m",
    "5m": "5m",
    "10m": "15m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
};

const MAX_MONITORS_PER_USER = 2

const toPrismaInterval = (val) => INTERVAL_TO_PRISMA[val] || "m5";
const fromPrismaInterval = (val) => PRISMA_TO_INTERVAL[val] || val;

const sanitizeLastResult = (lastResult) => {
    if (!lastResult || typeof lastResult !== "object") return lastResult;
    const { runnerName, runner, runnerId, ...clean } = lastResult;
    return clean;
};

const formatMonitor = (m) => {
    if (!m) return null;
    const { runnerId, runner, runnerName, ...rest } = m;
    return {
        ...rest,
        lastResult: sanitizeLastResult(rest.lastResult),
        _id: m.id,
        interval: fromPrismaInterval(m.interval),
    };
};

const formatResult = (r) => {
    if (!r) return null;
    const { runnerName, runner, runnerId, ...rest } = r;
    return {
        ...rest,
        id: r.id.toString(),
        _id: r.id.toString(),
    };
};

export const createMonitor = async (req, res) => {
    try {
        const { url, interval = "15m" } = req.body;

        if(interval === "5m" || interval === "1m"){
            return res.status(400).json({error:  "Coming soon !!"})
        }

        if (!url) {
            return res.status(400).json({ error: "URL is required." });
        }
        let parsedurl;

        try {
            parsedurl = new URL(url);
        } catch (err) {
            return res.status(400).json({ error: "Invalid URL format. Include http:// or https://" });
        }

        if (!ALLOWED_INTERVALS.has(interval)) {
            return res.status(400).json({ 
                error: `Invalid interval. Allowed values are: 1m, 5m, 15m, 30m, 1h` 
            });
        }

        const userId = Number(req.user._id || req.user.id);
        const roomId = `user:${userId}`;
        const monitorCount = await prisma.uptimeMonitor.count({ where: { userId } });

if (monitorCount >= MAX_MONITORS_PER_USER) {
    return res.status(403).json({
        error: `Monitor limit reached. You can create a maximum of ${MAX_MONITORS_PER_USER} monitors at this time.`
    });
}
        const hostinginfo = await getDomainHostingInfo(parsedurl.hostname);

        const monitor = await prisma.uptimeMonitor.create({
            data: {
                url: parsedurl.href,
                interval: toPrismaInterval(interval),
                status: "active",
                userId,
                hostinginfo: hostinginfo || undefined,
            }
        });

        const formattedMonitor = formatMonitor(monitor);

        try {
            await createUptimeScheduler(formattedMonitor, roomId);
        } catch (schedulerError) {
            await prisma.uptimeMonitor.delete({ where: { id: monitor.id } }).catch(() => {});
            console.error(`[MonitorCreation] Scheduler failed, rollback successful for ${monitor.id}:`, schedulerError);
            
            return res.status(500).json({ 
                error: "Failed to initialize the background scheduler. Please try again." 
            });
        }

        return res.status(201).json({
            message: "Monitor created successfully",
            roomId,
            monitor: {
                id: monitor.id,
                _id: monitor.id,
                url: monitor.url,
                interval: fromPrismaInterval(monitor.interval),
                status: monitor.status,
                hostinginfo: monitor.hostinginfo,
                createdAt: monitor.createdAt,
            }
        });

    } catch (error) {
        console.error("[MonitorCreation] Unexpected error:", error);

        if (error.code === "P2002") {
            return res.status(409).json({
                error: "A monitor for this URL already exists for your account."
            });
        }
        
        return res.status(500).json({
            error: "An unexpected internal server error occurred."
        });
    }
};

// UPDATE
export const updateMonitor = async (req, res) => {
    try {   
        const { id } = req.params;
        const { url, interval, status } = req.body;
        
         if(interval === "5m" || interval === "1m"){
            return res.status(400).json({error:  "Coming soon !!"})
        }

        try {
            new URL(url);
        } catch (err) {
            return res.status(400).json({ error: "Invalid URL format. Include http:// or https://" });
        }

        if (!ALLOWED_INTERVALS.has(interval)) {
            return res.status(400).json({
                error: `Invalid interval. Allowed values are: 1m, 5m, 15m, 30m, 1h`
            });
        }

        if (!ALLOWED_STATUSES.has(status)) {
            return res.status(400).json({ error: `Invalid Status.` });
        }

        const monitorId = parseInt(id, 10);
        if (Number.isNaN(monitorId)) {
            return res.status(404).json({ error: "Monitor not found" });
        }

        const existing = await prisma.uptimeMonitor.findUnique({
            where: { id: monitorId },
        });
        if (!existing) {
            return res.status(404).json({ error: "Monitor not found" });
        }

        const userId = Number(req.user._id || req.user.id);
        const isOwner = existing.userId === userId;
    


        
        const isAdminUser = req.user.role === "Admin" || req.user.role === "SuperAdmin";
        if (!isOwner && !isAdminUser) {
            return res.status(403).json({ error: "Access denied: You do not have permission to update this monitor." });
        }

        const roomId = `user:${existing.userId}`;

        const monitor = await prisma.uptimeMonitor.update({
            where: { id: monitorId },
            data: {
                url: url,
                interval: toPrismaInterval(interval),
                status: status,
            },
        });

        const formattedMonitor = formatMonitor(monitor);

        try {
            if (formattedMonitor.status === "active") {
                await updateUptimeScheduler(formattedMonitor, roomId);
            } else if (formattedMonitor.status === "paused") {
                await removeUptimeScheduler(formattedMonitor.id, roomId);
            }
        } catch (schedulerError) {
            console.error(`[MonitorUpdate] Scheduler sync failed for ${id}:`, schedulerError);
            return res.status(500).json({ 
                error: "Database updated, but failed to sync the background timer. Please try again." 
            });
        }

        return res.status(200).json({ message: "Monitor updated", monitor: formattedMonitor });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
};

// PAUSE
export const pauseMonitor = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ error: "Monitor ID is required" });
        }

        const monitorId = parseInt(id, 10);
        if (Number.isNaN(monitorId)) {
            return res.status(404).json({ error: "Monitor not found" });
        }

        const monitor = await prisma.uptimeMonitor.findUnique({
            where: { id: monitorId },
        });
        
        if (!monitor) {
            return res.status(404).json({ error: "Monitor not found" });
        }

        const userId = Number(req.user._id || req.user.id);
        const isOwner = monitor.userId === userId;
        const isAdminUser = req.user.role === "Admin" || req.user.role === "SuperAdmin";
        if (!isOwner && !isAdminUser) {
            return res.status(403).json({ error: "Access denied: You do not have permission to pause this monitor." });
        }

        const roomId = `user:${monitor.userId}`;

        try {
            await removeUptimeScheduler(monitor.id, roomId); 
        } catch (error) {
            return res.status(500).json({ 
                error: "Failed to pause the background scheduler. Please try again." 
            });
        }

        const updated = await prisma.uptimeMonitor.update({
            where: { id: monitorId },
            data: { status: "paused" },
        });

        return res.status(200).json({ message: "Monitor paused", monitor: formatMonitor(updated) }); 
    } catch (error) { 
        console.error(error); 
        return res.status(500).json({ error: "An internal server error occurred." });
    }
};

// RESUME
export const resumeMonitor = async (req, res) => {
    try {
        const { id } = req.params;
        const monitorId = parseInt(id, 10);
        if (Number.isNaN(monitorId)) {
            return res.status(404).json({
                error: "Monitor not found"
            });
        }

        const monitor = await prisma.uptimeMonitor.findUnique({
            where: { id: monitorId },
        });

        if (!monitor) { 
            return res.status(404).json({
                error: "Monitor not found"
            });      
        }

        const userId = Number(req.user._id || req.user.id);
        const isOwner = monitor.userId === userId;
        const isAdminUser = req.user.role === "Admin" || req.user.role === "SuperAdmin";
        if (!isOwner && !isAdminUser) {
            return res.status(403).json({ error: "Access denied: You do not have permission to resume this monitor." });
        }

        const roomId = `user:${monitor.userId}`;
        const formattedMonitor = formatMonitor(monitor);

        if (monitor.status === "active") {
            return res.status(200).json({
                message: "Monitor is already active",
                monitor: formattedMonitor,
            });
        }

        // Store previous status in case we need to roll back
        const previousStatus = monitor.status;
        
        const updated = await prisma.uptimeMonitor.update({
            where: { id: monitorId },
            data: { status: "active" },
        });

        const updatedFormatted = formatMonitor(updated);

        try {
            await createUptimeScheduler(updatedFormatted, roomId); // Starting the scheduler
        } catch (schedulerError) {
            console.error("Failed to start scheduler, rolling back DB:", schedulerError);
            await prisma.uptimeMonitor.update({
                where: { id: monitorId },
                data: { status: previousStatus },
            }).catch(() => {});
            
            return res.status(500).json({
                error: "Failed to start the monitoring process. Monitor remains paused."
            });
        }

        return res.status(200).json({
            message: "Monitor resumed successfully",
            monitor: updatedFormatted,
        });
    } catch (error) {
        console.error("Error resuming monitor:", error);
        return res.status(500).json({
            error: "An internal server error occurred while resuming the monitor"
        });
    }
};

// DELETE
export const deleteMonitor = async (req, res) => {
    try {
        const { id } = req.params;
        const monitorId = parseInt(id, 10);
        if (Number.isNaN(monitorId)) {
            return res.status(404).json({
                error: "Monitor not found"
            });
        }

        const monitor = await prisma.uptimeMonitor.findUnique({
            where: { id: monitorId },
        });

        if (!monitor) {
            return res.status(404).json({
                error: "Monitor not found"
            });
        }

        const userId = Number(req.user._id || req.user.id);
        const isOwner = monitor.userId === userId;
        const isAdminUser = req.user.role === "Admin" || req.user.role === "SuperAdmin";
        if (!isOwner && !isAdminUser) {
            return res.status(403).json({ error: "Access denied: You do not have permission to delete this monitor." });
        }

        const roomId = `user:${monitor.userId}`;

        try {
            await removeUptimeScheduler(monitor.id, roomId);
        } catch (schedulerError) {
            console.warn(`Failed to remove scheduler for monitor ${id}, proceeding with DB deletion:`, schedulerError);
        }

        await prisma.$transaction([
            prisma.uptimeResult.deleteMany({ where: { monitorId } }),
            prisma.uptimeMonitor.delete({ where: { id: monitorId } }),
        ]);

        return res.status(200).json({
            message: "Monitor deleted successfully"
        });
    } catch (error) {
        console.error("Error deleting monitor:", error);
        return res.status(500).json({
            error: "An internal server error occurred while deleting the monitor"
        });
    }
};

// GET: Fetch all monitors for current user with optional status filter & pagination
export const getMonitors = async (req, res) => {
    try {
        const userId = Number(req.user._id || req.user.id);
        const { status, page = 1, limit = 20 } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const skip = (pageNum - 1) * limitNum;

        const where = { userId };
        if (status && ALLOWED_STATUSES.has(status)) {
            where.status = status;
        }

        const [monitors, total] = await Promise.all([
            prisma.uptimeMonitor.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip,
                take: limitNum,
            }),
            prisma.uptimeMonitor.count({ where }),
        ]);

        return res.status(200).json({
            success: true,
            monitors: monitors.map(formatMonitor),
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
            },
        });
    } catch (error) {
        console.error("Error fetching monitors:", error);

        return res.status(500).json({
            success: false,
            error: "An internal server error occurred while fetching monitors",
        });
    }
};

export const getRunningMonitorDetails = async (req, res) => {
    try {
        const userId = Number(req.user._id || req.user.id);
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                error: "Monitor ID is required",
            });
        }

        const monitorId = parseInt(id, 10);
        if (Number.isNaN(monitorId)) {
            return res.status(404).json({
                success: false,
                error: "Uptime monitor not found",
            });
        }

        // Query by monitorId and userId to enforce strict multi-tenant ownership
        const monitor = await prisma.uptimeMonitor.findFirst({
            where: {
                id: monitorId,
                userId,
            },
        });

        if (!monitor) {
            return res.status(404).json({
                success: false,
                error: "Uptime monitor not found",
            });
        }

        return res.status(200).json({
            success: true,
            monitor: formatMonitor(monitor),
        });
    } catch (error) {
        console.error("Error fetching running monitor details:", error);
        return res.status(500).json({
            success: false,
            error: "Failed to fetch monitor details",
        });
    }
};

export const getRecentMonitorResults = async (req, res) => {
    try {
        const userId = Number(req.user._id || req.user.id);
        const { id } = req.params;
        const { page = 1, limit = 50, status } = req.query;

        if (!id) {
            return res.status(400).json({
                success: false,
                error: "Monitor ID is required",
            });
        }

        const monitorId = parseInt(id, 10);
        if (Number.isNaN(monitorId)) {
            return res.status(404).json({
                success: false,
                error: "Uptime monitor not found",
            });
        }

        // 1. Verify monitor exists and belongs to the user
        const monitorExists = await prisma.uptimeMonitor.findFirst({
            where: {
                id: monitorId,
                userId,
            },
            select: { id: true },
        });

        if (!monitorExists) {
            return res.status(404).json({
                success: false,
                error: "Uptime monitor not found",
            });
        }

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
        const skip = (pageNum - 1) * limitNum;

        const where = {
            monitorId,
            userId,
        };

        if (status) {
            where.result = {
                path: ["status"],
                equals: status.toUpperCase(),
            };
        }

        const [results, total] = await Promise.all([
            prisma.uptimeResult.findMany({
                where,
                select: {
                    id: true,
                    monitorId: true,
                    userId: true,
                    result: true,
                    checkedAt: true,
                },
                orderBy: { checkedAt: "desc" },
                skip,
                take: limitNum,
            }),
            prisma.uptimeResult.count({ where }),
        ]);

        return res.status(200).json({
            success: true,
            monitorId: id,
            results: results.map(formatResult),
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
            },
        });
    } catch (error) {
        console.error("Error fetching recent monitor results:", error);
        return res.status(500).json({
            success: false,
            error: "Failed to fetch monitor results",
        });
    }
};

// Re-export admin RBAC monitor controller functions
export {
    adminGetMonitorStats,
    adminGetTotalMonitors,
    adminGetAllMonitors,
    adminGetMonitorDetails,
    adminPauseMonitor,
    adminResumeMonitor,
    adminActivateMonitor,
    adminDeleteMonitor,
    adminDeleteActiveMonitors,
    adminBulkPauseMonitors,
    adminBulkResumeMonitors,
    adminTriggerMonitorCheck,
    adminCreateMonitor,
    adminUpdateMonitor,
    adminBulkDeleteMonitors,
    adminClearMonitorResults,
    adminBulkUpdateInterval,
    adminGetMonitorIncidents,
    adminExportMonitors,
    adminGetRunners,
    adminCreateRunner,
    adminActivateRunner,
    adminTestRunner,
    adminDeleteRunner,
} from "./Admin.Controller.js";

