import { model, Schema } from "mongoose";

const uptimeMonitorSchema = new Schema(
    {

         
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
            },
            
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
        },

        lastResult: {
            type: Schema.Types.Mixed,
            default: null,
        },

        lastCheckedAt: {
            type: Date,
            default: null,
        },

 
    },
    {
        timestamps: true
    }
);

uptimeMonitorSchema.index({ userId: 1, url: 1 }, { unique: true });


export const UptimeMonitor = model( "UptimeMonitor", uptimeMonitorSchema );