import { QueueEvents } from "bullmq";
import {  queueEventsConn2 } from "../config/redis.js";

export const indiaTtfbQueueEvent = new QueueEvents("ttfb-india", {
    connection: queueEventsConn2
});

export const europeTtfbQueueEvent = new QueueEvents("ttfb-europe", {
    connection: queueEventsConn2
});

export const usaTtfbQueueEvent = new QueueEvents("ttfb-usa", {
    connection: queueEventsConn2
});
