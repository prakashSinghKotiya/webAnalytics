import { UptimeMonitor } from "../Models/UptimeMonitor.Model.js";

import {
    createUptimeScheduler,
    updateUptimeScheduler,
    removeUptimeScheduler
} from "../Services/uptimeScheduler.Service.js";


// CREATE

export const createMonitor = async (req, res) => {

    try {

        const {
            url,
            interval = "5m"
        } = req.body;


        if (!url) {

            return res.status(400).json({
                error: "URL is required"
            });

        }


        const allowedIntervals = [
            "1m",
            "5m",
            "10m",
            "30m",
            "1h"
        ];


        if (!allowedIntervals.includes(interval)) {

            return res.status(400).json({
                error: "Invalid interval"
            });

        }


        const monitor =
            await UptimeMonitor.create({
                url,
                interval,
                status: "active"
            });


        await createUptimeScheduler(
            monitor
        );


        return res.status(201).json({
            message: "Monitor created",
            monitor
        });


    } catch (error) {

        console.error(error);

        return res.status(500).json({
            error: error.message
        });

    }
};



// UPDATE

export const updateMonitor = async (req, res) => {

    try {

        const {
            id
        } = req.params;


        const {
            url,
            interval
        } = req.body;


        const monitor =
            await UptimeMonitor.findById(id);


        if (!monitor) {

            return res.status(404).json({
                error: "Monitor not found"
            });

        }


        if (url !== undefined) {
            monitor.url = url;
        }


        if (interval !== undefined) {

            const allowedIntervals = [
                "1m",
                "5m",
                "10m",
                "30m",
                "1h"
            ];


            if (!allowedIntervals.includes(interval)) {

                return res.status(400).json({
                    error: "Invalid interval"
                });

            }


            monitor.interval = interval;
        }


        await monitor.save();


        if (monitor.status === "active") {

            await updateUptimeScheduler(
                monitor
            );

        }


        return res.status(200).json({
            message: "Monitor updated",
            monitor
        });


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