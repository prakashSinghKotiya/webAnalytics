import { UptimeMonitor } from "../Models/UptimeMonitor.Model.js";
import { UptimeResult } from "../Models/UptimeResults.Model.js";

import {
    createUptimeScheduler,
    updateUptimeScheduler,
    removeUptimeScheduler
} from "../Services/uptimeScheduler.Service.js";



const ALLOWED_INTERVALS = new Set(["1m", "5m", "10m", "30m", "1h"]);
const ALLOWED_STATUSES = new Set(["active", "paused"]);



export const createMonitor = async (req, res) => {
    try {
        const { url, interval = "5m" } = req.body;

        if (!url) {
            return res.status(400).json({ error: "URL is required." });
        }

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

        const roomId = `user:${req.user._id}`

        const monitor = await UptimeMonitor.create({
            url,
            interval,
            status: "active",
            userId: req.user._id
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
                status: monitor.status
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
        const { url, interval , status } = req.body;
        const roomId = `user:${req.user._id}`



        try{
            new URL(url)
        }
        catch(err){
            return res.status(400).json({ error: "Invalid URL format. Include http:// or https://" });
        }

        if(!ALLOWED_INTERVALS.has(interval)){
            return res.status(400).json({
                error: `Invalid interval. Allowed values are: ${[...ALLOWED_INTERVALS].join(", ")}`
            })
        }

        if(!ALLOWED_STATUSES.has(status)){
            return res.status(400).json({  error: `Invalid Status. `
            })
        }

        const monitor = await UptimeMonitor.findByIdAndUpdate(id , {
            url : url,
            interval : interval,
            status : status
        } , {returnDocument : "after"}).lean()

        if (!monitor) { return res.status(404).json({  error: "Monitor not found"  }); }


        

           try {
            if (monitor.status === "active") {
                await updateUptimeScheduler(monitor,roomId);
            }else if(monitor.status === "paused"){
                await removeUptimeScheduler(monitor._id , roomId)
            }

            } catch (schedulerError) {
                console.error(`[MonitorUpdate] Scheduler sync failed for ${id}:`, schedulerError);
                return res.status(500).json({ 
                    error: "Database updated, but failed to sync the background timer. Please try again." 
                }); }

        return res.status(200).json({  message: "Monitor updated",  monitor });


    } catch (error) {

        console.error(error);

        return res.status(500).json({
            error: error.message
        });

    }
};



// PAUSE

export const pauseMonitor = async (req, res) => {
    try {
        const { id } = req.params;
         const roomId = `user:${req.user._id}`

        if (!id) {
            return res.status(400).json({ error: "Monitor ID is required" });
        }


        const monitor = await UptimeMonitor.findById(id);
        
        if (!monitor) {
            return res.status(404).json({ error: "Monitor not found" });
        }

        try {
            await removeUptimeScheduler(monitor._id,roomId); 
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
        const roomId = `user:${req.user._id}`
        const monitor = await UptimeMonitor.findById(id);

        if (!monitor) { 
             return res.status(404).json({
                error: "Monitor not found"
            });      
        }

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
            
            await createUptimeScheduler(monitor,roomId);  //   Starting the scheduler
        } catch (schedulerError) {
            //  Rollback if the scheduler fails to start
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
        
        // Do not expose raw error messages to the client in production
        return res.status(500).json({
            error: "An internal server error occurred while resuming the monitor"
        });
    }
};



// DELETE

export const deleteMonitor = async (req, res) => {
    try {
        const { id } = req.params;
        const roomId = `user:${req.user._id}`

        const monitor = await UptimeMonitor.findById(id);

        if (!monitor) {
            return res.status(404).json({
                error: "Monitor not found"
            });
        }


        try {
            await removeUptimeScheduler(monitor._id,roomId);
        } catch (schedulerError) {
           
            //not returnning we will delte it ayway from db , scheduler can be already dead 
            console.warn(`Failed to remove scheduler for monitor ${id}, proceeding with DB deletion:`, schedulerError);
        }

        
        await monitor.deleteOne();

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