import { QueueEvents } from "bullmq";
import connection, { sharedWorkerRedisConnection } from "../config/redis.js"



export const indiaTtfbQueueEvent = new QueueEvents("ttfb-india", {
        connection: sharedWorkerRedisConnection
    });

export const europeTtfbQueueEvent = new QueueEvents("ttfb-europe", {
        connection: sharedWorkerRedisConnection
    });

export const usaTtfbQueueEvent = new QueueEvents("ttfb-usa", {
        connection: sharedWorkerRedisConnection
    });

