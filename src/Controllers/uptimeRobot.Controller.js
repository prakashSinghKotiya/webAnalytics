import { UptimeMonitor } from "../Models/UptimeMonitor.Model.js";

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

        const monitor = await UptimeMonitor.create({
            url,
            interval,
            status: "active"
        });


        try {
            await createUptimeScheduler(monitor);
        } catch (schedulerError) {
            await UptimeMonitor.findByIdAndDelete(monitor._id);
            console.error(`[MonitorCreation] Scheduler failed, rollback successful for ${monitor._id}:`, schedulerError);
            
            return res.status(500).json({ 
                error: "Failed to initialize the background scheduler. Please try again." 
            });
        }

        return res.status(201).json({
            message: "Monitor created successfully",
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
                await updateUptimeScheduler(monitor);
            }else if(monitor.status === "paused"){
                await removeUptimeScheduler(monitor._id)
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

        const {    id } = req.params;


        const monitor =  await UptimeMonitor.findById(id);


        if (!monitor) { 
              return res.status(404).json({
                error: "Monitor not found"
            });

        }


        monitor.status = "paused";

        await monitor.save();


        await removeUptimeScheduler(
            monitor._id
        );


        return res.status(200).json({
            message: "Monitor paused",
            monitor
        });


    } catch (error) {

        console.error(error);

        return res.status(500).json({
            error: error.message
        });

    }
};



// RESUME

export const resumeMonitor = async (req, res) => {

    try {

        const {  id } = req.params;
        const monitor = await UptimeMonitor.findById(id);

        if (!monitor) { 
             return res.status(404).json({
                error: "Monitor not found"
            });      }


        monitor.status = "active";
        await monitor.save();


        await createUptimeScheduler(
            monitor
        );


        return res.status(200).json({
            message: "Monitor resumed",
            monitor
        });


    } catch (error) {

        console.error(error);

        return res.status(500).json({
            error: error.message
        });

    }
};



// DELETE

export const deleteMonitor = async (req, res) => {

    try {

        const {
            id
        } = req.params;


        const monitor =
            await UptimeMonitor.findById(id);


        if (!monitor) {

            return res.status(404).json({
                error: "Monitor not found"
            });

        }


        await removeUptimeScheduler(
            monitor._id
        );


        await UptimeMonitor.findByIdAndDelete(
            id
        );


        return res.status(200).json({
            message: "Monitor deleted"
        });


    } catch (error) {

        console.error(error);

        return res.status(500).json({
            error: error.message
        });

    }
};



// GET

export const getMonitors = async (req, res) => {

    try {

        const monitors =
            await UptimeMonitor.find()
                .sort({ createdAt: -1 });


        return res.status(200).json({
            monitors
        });


    } catch (error) {

        return res.status(500).json({
            error: error.message
        });

    }
};