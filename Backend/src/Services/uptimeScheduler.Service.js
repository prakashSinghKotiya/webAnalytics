import { uptimeMonitorQueue } from "../queue/uptime.queue.js";

const INTERVALS = {
    "1m": 60 * 1000,
    "5m": 5 * 60 * 1000,
    "10m": 10 * 60 * 1000,
    "30m": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000
};


const getInterval = (interval) => {

    const milliseconds = INTERVALS[interval];

    if (!milliseconds) {
        throw new Error(`Invalid interval: ${interval}`);
    }

    return milliseconds;
};


export const createUptimeScheduler = async (monitor,roomId) => {

    const every = getInterval(monitor.interval);
    console.log("MONITOR" ,monitor)
    
    const schedulerId = `uptime-monitor:${monitor._id}`; // Uptime monitor model id

    const job = await uptimeMonitorQueue.upsertJobScheduler(  // see adding jobs inside that queue after every interval and worker will run immidately seeing a new job .
        schedulerId, 

        { every },  // run after every interval

        {
            name: "uptime-scheduler-event",  // individual job (name) inside the main queue ie uptimeRobot-india

            data: {  monitorId: monitor._id.toString(), url: monitor.url , roomId:roomId },

            opts: {   attempts: 3, // if failed try 3 times 
                    backoff: { type: "exponential",  delay: 5000 }, // if failing try after 5 seconds then double 
                    removeOnComplete: 100, // only save last 100 jobs 
                    removeOnFail: 100 }  
        }
    );

    return {
        schedulerId,
        jobId: job?.id,
        roomId
    };
};


export const updateUptimeScheduler = async (monitor,roomId) => {

    return createUptimeScheduler(monitor,roomId);
};


export const removeUptimeScheduler = async (monitorId,roomId) => {

    const schedulerId = `uptime-monitor:${monitorId}`;

    const removed = await uptimeMonitorQueue.removeJobScheduler(
        schedulerId
    );

    return {...removed , roomId}
};