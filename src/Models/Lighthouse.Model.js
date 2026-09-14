import { model, Schema } from "mongoose";

const LighthouseSchema = new Schema(
    {
        url: {
            type: String,
            required: true,
            trim: true
        },
        
        data:{
            type: String,
            trime: true
        }

    },
    {
        timestamps: true
    }
);

export const Lighthouse = model( "UptimeMonitor", LighthouseSchema );