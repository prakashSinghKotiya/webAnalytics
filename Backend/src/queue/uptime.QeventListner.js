import { QueueEvents } from "bullmq";
import  { sharedWorkerRedisConnection } from "../config/redis.js"

export const indiaUptimeRobotEvent = new QueueEvents("uptimeRobot-india", {
        connection: sharedWorkerRedisConnection
    });


