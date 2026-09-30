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
           createdAt: { // ttl index 
    type: Date,
    default: Date.now,
    expires:  60 * 60 * 24 * 30, // 30 days
  },
    },
    {
        timestamps: true
    }
);

export const UptimeMonitor = model( "UptimeMonitor", uptimeMonitorSchema );