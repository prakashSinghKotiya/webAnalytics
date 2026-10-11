import { QueueEvents } from "bullmq";
import  { queueEventsConn2, sharedWorkerRedisConnection } from "../config/redis.js"

export const indiaUptimeRobotEvent = new QueueEvents("uptimeRobot-india", {
        connection: queueEventsConn2
    });


