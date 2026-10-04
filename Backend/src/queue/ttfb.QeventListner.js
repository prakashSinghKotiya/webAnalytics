import { QueueEvents } from "bullmq";
import connection from "../config/redis.js"



export const indiaTtfbQueueEvent = new QueueEvents("ttfb-india", {
        connection: { ...connection }
    });

export const europeTtfbQueueEvent = new QueueEvents("ttfb-europe", {
        connection: { ...connection }
    });

export const usaTtfbQueueEvent = new QueueEvents("ttfb-usa", {
        connection: { ...connection }
    });

