import { UptimeMonitor } from "../Models/UptimeMonitor.Model.js";
import { UptimeResult } from "../Models/UptimeResults.Model.js";

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



const ALLOWED_INTERVALS = new Set(["1m", "5m", "10m", "30m", "1h"]);
const ALLOWED_STATUSES = new Set(["active", "paused"]);



export const createMonitor = async (req, res) => {
    try {
        const { url, interval = "5m" } = req.body;

        

        if (!url) {
            return res.status(400).json({ error: "URL is required." });
        }
        let parsedurl 

        try {
          parsedurl = new URL(url);
        } catch (err) {
            return res.status(400).json({ error: "Invalid URL format. Include http:// or https://" });
        }

        if (!ALLOWED_INTERVALS.has(interval)) {
            return res.status(400).json({ 
                error: `Invalid interval. Allowed values are: ${[...ALLOWED_INTERVALS].join(", ")}` 
            });
        }

        const roomId = `user:${req.user._id}`
        const hostinginfo =  await getDomainHostingInfo(parsedurl.hostname)

        const monitor = await UptimeMonitor.create({
            url:parsedurl.href,
            interval,
            status: "active",
            userId: req.user._id,
            hostinginfo
        });
 

        try {
            await createUptimeScheduler(monitor,roomId);
        } catch (schedulerError) {
            await UptimeMonitor.findByIdAndDelete(monitor._id);
            console.error(`[MonitorCreation] Scheduler failed, rollback successful for ${monitor._id}:`, schedulerError);
            
            return res.status(500).json({ 
                error: "Failed to initialize the background scheduler. Please try again." 
            });
        }

        return res.status(201).json({
            message: "Monitor created successfully",
            roomId,
            monitor: {
                id: monitor._id,
                url: monitor.url,
                interval: monitor.interval,
                status: monitor.status,
                hostinginfo: monitor.hostinginfo,
                
            }
        });

    } catch (error) {
        
        console.error("[MonitorCreation] Unexpected error:", error);
        
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

        try {
            new URL(url);
        } catch (err) {
            return res.status(400).json({ error: "Invalid URL format. Include http:// or https://" });
        }

        if (!ALLOWED_INTERVALS.has(interval)) {
            return res.status(400).json({
                error: `Invalid interval. Allowed values are: ${[...ALLOWED_INTERVALS].join(", ")}`
            });
        }

        if (!ALLOWED_STATUSES.has(status)) {
            return res.status(400).json({ error: `Invalid Status.` });
        }

        const existing = await UptimeMonitor.findById(id);
        if (!existing) {
            return res.status(404).json({ error: "Monitor not found" });
        }

        const isOwner = existing.userId.toString() === req.user._id.toString();
        const isAdminUser = req.user.role === "Admin";
        if (!isOwner && !isAdminUser) {
            return res.status(403).json({ error: "Access denied: You do not have permission to update this monitor." });
        }

        const roomId = `user:${existing.userId}`;

        const monitor = await UptimeMonitor.findByIdAndUpdate(id, {
            url: url,
            interval: interval,
            status: status
        }, { returnDocument: "after" }).lean();

        try {
            if (monitor.status === "active") {
                await updateUptimeScheduler(monitor, roomId);
            } else if (monitor.status === "paused") {
                await removeUptimeScheduler(monitor._id, roomId);
            }
        } catch (schedulerError) {
            console.error(`[MonitorUpdate] Scheduler sync failed for ${id}:`, schedulerError);
            return res.status(500).json({ 
                error: "Database updated, but failed to sync the background timer. Please try again." 
            });
        }

        return res.status(200).json({ message: "Monitor updated", monitor });
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

        const monitor = await UptimeMonitor.findById(id);
        
        if (!monitor) {
            return res.status(404).json({ error: "Monitor not found" });
        }

        const isOwner = monitor.userId.toString() === req.user._id.toString();
        const isAdminUser = req.user.role === "Admin";
        if (!isOwner && !isAdminUser) {
            return res.status(403).json({ error: "Access denied: You do not have permission to pause this monitor." });
        }

        const roomId = `user:${monitor.userId}`;

        try {
            await removeUptimeScheduler(monitor._id, roomId); 
        } catch (error) {
            return res.status(500).json({ 
                error: "Failed to pause the background scheduler. Please try again." 
            });
        }

        monitor.status = "paused";
        await monitor.save();

        return res.status(200).json({ message: "Monitor paused", monitor }); 
    } catch (error) { 
        console.error(error); 
        return res.status(500).json({ error: "An internal server error occurred." });
    }
};


// RESUME

export const resumeMonitor = async (req, res) => {
    try {
        const { id } = req.params;
        const monitor = await UptimeMonitor.findById(id);

        if (!monitor) { 
             return res.status(404).json({
                error: "Monitor not found"
            });      
        }

        const isOwner = monitor.userId.toString() === req.user._id.toString();
        const isAdminUser = req.user.role === "Admin";
        if (!isOwner && !isAdminUser) {
            return res.status(403).json({ error: "Access denied: You do not have permission to resume this monitor." });
        }

        const roomId = `user:${monitor.userId}`;

        if (monitor.status === "active") {
            return res.status(200).json({
                message: "Monitor is already active",
                monitor
            });
        }

        // Store previous status in case we need to roll back
        const previousStatus = monitor.status;
        
        monitor.status = "active";
        await monitor.save();

        try {
            await createUptimeScheduler(monitor, roomId); // Starting the scheduler
        } catch (schedulerError) {
            console.error("Failed to start scheduler, rolling back DB:", schedulerError);
            monitor.status = previousStatus; // Revert to paused/stopped
            await monitor.save();
            
            return res.status(500).json({
                error: "Failed to start the monitoring process. Monitor remains paused."
            });
        }

        return res.status(200).json({
            message: "Monitor resumed successfully",
            monitor
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

        const monitor = await UptimeMonitor.findById(id);

        if (!monitor) {
            return res.status(404).json({
                error: "Monitor not found"
            });
        }

        const isOwner = monitor.userId.toString() === req.user._id.toString();
        const isAdminUser = req.user.role === "Admin";
        if (!isOwner && !isAdminUser) {
            return res.status(403).json({ error: "Access denied: You do not have permission to delete this monitor." });
        }

        const roomId = `user:${monitor.userId}`;

        try {
            await removeUptimeScheduler(monitor._id, roomId);
        } catch (schedulerError) {
            console.warn(`Failed to remove scheduler for monitor ${id}, proceeding with DB deletion:`, schedulerError);
        }

        await Promise.all([
            monitor.deleteOne(),
            UptimeResult.deleteMany({ monitorId: monitor._id }),
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
        const userId = req.user._id;
        const { status, page = 1, limit = 20 } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const skip = (pageNum - 1) * limitNum;

        const query = { userId };
        if (status && ALLOWED_STATUSES.has(status)) {
            query.status = status;
        }

        const [monitors, total] = await Promise.all([
            UptimeMonitor.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            UptimeMonitor.countDocuments(query),
        ]);

        return res.status(200).json({
            success: true,
            monitors,
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
        const userId = req.user._id;
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                error: "Monitor ID is required",
            });
        }

        // Query by monitorId and userId to enforce strict multi-tenant ownership
        const monitor = await UptimeMonitor.findOne({
            _id: id,
            userId,
        }).lean();

        if (!monitor) {
            return res.status(404).json({
                success: false,
                error: "Uptime monitor not found",
            });
        }

        return res.status(200).json({
            success: true,
            monitor,
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
        const userId = req.user._id;
        const { id } = req.params;
        const { page = 1, limit = 50, status } = req.query;

        if (!id) {
            return res.status(400).json({
                success: false,
                error: "Monitor ID is required",
            });
        }

        // 1. Verify monitor exists and belongs to the user
        const monitorExists = await UptimeMonitor.exists({
            _id: id,
            userId,
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

        // Uses compound index { monitorId: 1, checkedAt: -1 }
        const query = {
            monitorId: id,
            userId,
        };

        if (status) {
            query["result.status"] = status.toUpperCase();
        }

        const [results, total] = await Promise.all([
            UptimeResult.find(query)
                .sort({ checkedAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            UptimeResult.countDocuments(query),
        ]);

        return res.status(200).json({
            success: true,
            monitorId: id,
            results,
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
} from "./Admin.Controller.js";