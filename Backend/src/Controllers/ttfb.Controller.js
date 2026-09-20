import { Ttfb } from "../Models/Ttfb.Model.js";
import { europeTtfbQueue, indiaTtfbQueue, usaTtfbQueue } from "../queue/ttfb.queue.js";
import crypto from "crypto";


const queue = {
india: indiaTtfbQueue,
europe: europeTtfbQueue,
usa: usaTtfbQueue,  
}

export const ttfbFinder = async (req, res) => {
try{
    const body = req.body;

    if (!body || !body.url) {
        return res.status(400).json({ error: "Missing 'url' in request body" });
    }

    const roomId = crypto.randomUUID();

    const workerEventqueue = queue[body.region];
    if (!workerEventqueue) {
        return res.status(400).json({ error: "Invalid region" });
    }
    const ttfb = await Ttfb.create({userId: req.user._id , url : body.url, region : body.region})

  const job = await workerEventqueue.add("measure-ttfb", {   // addding data to queue
      targetUrl: body.url,
      roomId: roomId
    });
    console.log(job)


    return res.status(202).json({
      success: true,
      message: "TTFB analysis started",
      jobId: job.id,   // we will emmit this jobid from frontend and listen for the result in socket.io to get job id andcreate a room and send result to that specific room
      region: body.region,
      roomId : roomId
    });


 

}catch(e){
    console.log(e)
    return res.status(500).json({
      success: false,
      message: "Failed to create TTFB job",
    });
}

}

export const allRegionttfbFinder = async (req, res) => {
try{
    const body = req.body;
    if(!body || !body.url ){
        return res.status(400).json({ error: "Missing 'url' or 'region' in request body" });
    }

    if (body.region !== "All") {
        return res.status(400).json({ error: "Invalid 'region' in request body" });
    }

    const regions = ["india", "europe", "usa"]

    const roomId = crypto.randomUUID();
    const jobid = []

    await Ttfb.create({userId: req.user._id , url : body.url, region : regions})

    for(const region of Object.keys(queue)) {

        const workerEventqueue = queue[region];
        console.log("workerEventqueue instance from controller ttfb :", workerEventqueue)
        const job = await workerEventqueue.add("measure-ttfb-all", {   // addding job to queue (inside redis)
        targetUrl: body.url,
        roomId: roomId
       
    });
    console.log(job)
    jobid.push({id: job.id, region})
    }

    return res.status(202).json({
      success: true,
      message: "TTFB analysis started",
      jobId: jobid,   // we will emmit this jobid from frontend and listen for the result in socket.io to get job id andcreate a room and send result to that specific room
      region: body.region,
      roomId : roomId
    });


 

}catch(e){
    console.log(e)
    return res.status(500).json({
      success: false,
      message: "Failed to create TTFB job",
    });
}

} 