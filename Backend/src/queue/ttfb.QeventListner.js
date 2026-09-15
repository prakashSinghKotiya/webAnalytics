import { QueueEvents } from "bullmq";
import connection from "../config/redis.js"



export const indiaTtfbQueueEvent = new QueueEvents("ttfb-india", {
        connection
    });

export const europeTtfbQueueEvent =  new QueueEvents("ttfb-europe", {
        connection
    });

export const usaTtfbQueueEvent = new QueueEvents("ttfb-usa", {
        connection
    });

