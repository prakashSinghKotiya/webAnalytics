
import bcrypt from "bcrypt"

import mongoose, { Types } from "mongoose"
import redisDb from "../database/redis.js"
import OTP from "../Models/Otp.Model.js"
import User from "../Models/User.Model.js"
import Session from "../Models/Session.Model.js"
import { loginSchema, registerSchema } from "../Validators/ZodSchema.js"



export const registerUser = async(req, res, next)=>{
    
    const {success , data , error} = registerSchema.safeParse(req.body) //sanitizing db inputs

    if(!success){
        return res.status(400).json({error: z.flattenError(error).fieldErrors})

    }
    const{email , name , password,otp} = data
    

    const otprecord= await OTP.findOne({email,otp})
       if(!otprecord){
        return res.status(400).json({error: " invalid otp "})
       }

       await otprecord.deleteOne() 
   
    const hashPassword = await bcrypt.hash(password, 12 ) 
  
    const userExist = await User.findOne({email})
    if(userExist){
        return res.status(409).json({
                error: "user already exist" ,
                message: "user already exist"
            })}

    
      const ssn = await mongoose.startSession();
    
        try {
     ssn.startTransaction()     

     const userId = new Types.ObjectId();

    
    const userDir = await User.create([{ //creating user collection here 
        _id:userId,
        name,
        email,
        password:hashPassword,
    }],{session: ssn })
        
 
      ssn.commitTransaction() 


    res.status(201).json({ message: "User Registered" });
        
      } catch (err){
        console.log(err)
        await ssn.abortTransaction(); 
      if(err.code === 121) {
      res
        .json({ error: "Invalid input, please enter valid details" });

      
    } else {
      next(err);
    }
        
      }      

}

export const loginUser = async(req, res, next)=>{
    try{
         const {success , data , error} = loginSchema.safeParse(req.body) //sanitizing db inputs

    if(!success){
        console.log(error)
        return res.status(400).json({error: z.flattenError(error).fieldErrors})
    }
    const{email, password} = data
    
    
    const user = await User.findOne({email}) 
    if(!user){
        return res.status(404).json({ error: "Invalid Credentials" });
    }

     if(user.deleted){ //soft delete check 
          return res.status(403).json({error: "your account is eleted contact admin"})
      }
      

    const ispassValid = await bcrypt.compare(password, user.password) 
    if(!ispassValid){
        return res.status(404).json({ error: "Invalid Credentials" });
    }
    
    


    const allSessions = await Session.find({userId :  user._id}) 
    if(allSessions.length >= 2){  
       await allSessions[0].deleteOne()  }
   
  
    const session = await Session.create({userId: user._id}) 
     const sessionExpiryTime = 60 * 1000 * 60 * 24 * 7;
     

    res.cookie("sid", session._id ,{ 
        httpOnly: true,
        signed: true,
        maxAge: sessionExpiryTime,
        sameSite: "none",   
        secure: true
    })
    res.json({ message: "logged in" });
}
    catch(err){
        console.log(err)
        next(err)
    }
}

    

export const userDetails = async(req, res)=>{ 
    console.log("req",req.user);
    const user = await User.findById(req.user._id)
    

    
    res.status(200).json({
        name : user.name, //see here we are using req.user that we have set in authentication and getting userdetail easily
        email: user.email,
        picture: user.picture,
        plan : user.plans
        
    })


}

export const getAllUsers = async(req, res)=>{  //rbac get all user endpoint controller 
    const allUsers = await User.find({deleted : false }).lean() //only user that is not deleted will be fetched 
    //const session = await Session.find().lean()
    const keys = await redisDb.keys("session:*");
    console.log("redis",keys);
    const session= await Promise.all(keys.map((key) => redisDb.json.get(key))
);
    const activeSession = session.map(({userId})=> userId.toString()) // because of object id we have to conver it in string 
    const allSessionSet = new Set(activeSession) // this is creating  an set of all active session can say an array of allsession

    const gettingUsers = allUsers.map(({_id,email,name}) =>({
        id:_id,
        name ,
        email,
        isLogedin : allSessionSet.has(_id.toString()) // creating an extra property if user session is not there it will be false els true 
    })) 
     res.status(200).json( gettingUsers)
   

}

export const adminPowerlogout = async(req,res,next)=>{ //rbac
  try {
      const id = req.params.userId
    await Session.deleteMany({userId:id}) 
     res.status(204).end();
    
  } catch (error) {
    next(error)
    }}

export const DeleteUser = async(req,res,next)=>{ //rbac
  
    
      const {userId} = req.params
      if(req.user._id.toString()  === userId){  //disabling self delete 
        return res.status(403).json({error : "you cannot delete yourself" }) 
      } 

        try {
     // await User.findByIdAndDelete({_id : userId})          this was hard delete we will implement soft delete
     // await File.deleteMany({userId})
     // await Directory.deleteMany({userId})
      await Session.deleteMany({userId})
      await findByIdAndUpdate(userId , { deleted : true}) //soft delete so we can recover the data if user wants to 
    
  } catch (error) {
    next(error)
    }}    


export const logout = async (req, res)=>{
    const{sid} = req.signedCookies
    await Session.findByIdAndDelete(sid)  

 await redisDb.del(`session:${sid}`)
    res.clearCookie("sid") // this will clear the coookie ie the user id we have set and user will be logout
    res.status(204).end();
}

