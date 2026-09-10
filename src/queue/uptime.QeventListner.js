import { QueueEvents } from "bullmq";
import connection from "../config/redis.js"

export const indiaUptimeRobotEvent = new QueueEvents("uptimeRobot-india", { //listening to the queue events
        connection
    });


