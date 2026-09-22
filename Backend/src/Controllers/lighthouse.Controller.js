import { Lighthouse } from "../Models/Lighthouse.Model.js"
import { Lighthouequeue } from "../queue/Lighthouse.queue.js"


export const LighthouseResult = async(req ,res ,next)=>{

    try{
    const {url } = req.body
    if(! url ) return res.status(400).json({ error : "url is missing" } )

        try {
            new URL(url);
        } catch (err) {
            return res.status(400).json({ error: "Invalid URL format. Include http:// or https://" });
        }

         const roomId = `user:${req.user._id}`

        
       
    const lighthouseDb = await Lighthouse.create({
        url : url
    })
        

    const job = await Lighthouequeue.add("lighthouse-queue",{
        targetUrl: url,
        ligthouseId :  lighthouseDb._id,
        roomId: roomId
    } )

    if(!job){
        await Lighthouse.findByIdAndDelete(lighthouseDb._id)
        return res.status(400).json({ error : "service not working" })

    }

    return res.status(200).json({ message: "lighthouse is processing ", data : lighthouseDb ,roomId, job })

    }catch(err){
        console.log(err)

        return res.status(200).json({ error : "invalid req" , err})
        
    }

}