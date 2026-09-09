import mongoose from "mongoose";

const uptimeMonitorSchema = new mongoose.Schema(
    {
        url: {
            type: String,
            required: true,
            trim: true
        },

        interval: {
            type: String,
            enum: ["1m", "5m", "10m", "30m", "1h"],
            default: "5m"
        },

        status: {
            type: String,
            enum: ["active", "paused"],
            default: "active"
        }
    },
    {
        timestamps: true
    }
);

export const UptimeMonitor = mongoose.model(
    "UptimeMonitor",
    uptimeMonitorSchema
);