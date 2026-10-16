import mongoose, { Types } from "mongoose";
import Session from "../Models/Session.Model.js";
import User from "../Models/User.Model.js";
import { verifyIdToken } from "../Services/gAuth.Service.js";
import { gAuthSchema } from "../Validators/ZodSchema.js";
import z from "zod";

export const loginwithGoogle = async(req, res, next )=>{
   let mongooseSession = null;
  
     console.log("running auth controller ")
    const {idToken} = req.body  // we are getting id token from frontend using oauth2 gsi liabrary idtoken have the user details 
   

    if(!idToken){
      console.log("id token is required", req.body);
      return res.status(400).json({error: "id token is required"})
    }
    
    
    const userdata = await verifyIdToken(idToken)
    console.log("raw userdata from google:", userdata)
    
       const {success , data , error } = gAuthSchema.safeParse(userdata) //sanitizing using zod
      if(!success){
          return res.status(400).json({error: z.flattenError(error).fieldErrors})
      }
      
      
    const{name , email, picture , sub } = data
console.log(data)
console.log("picture:", picture)

    const user = await User.findOne({email})
 
    if(user){   // thsis block will run if user exist 
      if(user.deleted){//soft delete check 
          return res.status(403).json({error: "your account is deleted contact admin"})
      }

    const allSessions = await Session.find({userId :  user._id}) 
    if(allSessions.length >= 2){  
       await allSessions[0].deleteOne()  }
   
  
    const session = await Session.create({userId: user._id}) 
     const sessionExpiryTime = 60 * 1000 * 60 * 24 * 7;
     
    res.cookie("sid", session._id.toString() ,{  
        httpOnly: true,
        signed: true,
        maxAge: sessionExpiryTime, 
        sameSite: "none",  
        secure: true
    })
    console.log("Saved session:");

    return res.json({ message: "logged in" });

    }
    
    console.log("user dosent exist")

   
    
     mongooseSession = await mongoose.startSession();
     try {

      mongooseSession.startTransaction();
   
        const userId = new Types.ObjectId();
         await User.create([
          {
            _id: userId,
            name,
            email,
            
           
          },],
          {  session: mongooseSession }
        );
    
    const session = await Session.create({userId: userId}) 
     const sessionExpiryTime = 60 * 1000 * 60 * 24 * 7;

    res.cookie("sid", session._id.toString() ,{  
        httpOnly: true,
        signed: true,
        maxAge: sessionExpiryTime, 
        sameSite: "none",   
        secure: true
    })



    
        await mongooseSession.commitTransaction();
        res.status(201).json({ message: "account created and logged in" });
    
    
  }catch (err) {
        console.log(err); 
        if (mongooseSession) await mongooseSession.abortTransaction()
          res.status(500).json({ message: "Something went wrong!!" }, err);
      //  next(err);
      }finally {
    if (mongooseSession) await mongooseSession.endSession(); 
  }

}