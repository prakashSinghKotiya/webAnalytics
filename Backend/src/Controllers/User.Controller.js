
import bcrypt from "bcrypt"

import mongoose, { Types } from "mongoose"
//import redisDb from "../database/redis.js"
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
        name : user.name, 
        email: user.email,
        picture: user.picture,
        plan : user.plans
        
    })


}

export const getAllUsers = async (req, res) => {
    try {
        
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 10)); 
        const skip = (page - 1) * limit;

      
        const [users, totalUsers] = await Promise.all([
            User.find({ deleted: false })
                .select('_id name email role') 
                .skip(skip)
                .limit(limit)
                .lean() ,
            User.countDocuments({ deleted: false })
        ]);

       
        const totalPages = Math.ceil(totalUsers / limit);

    
        if (!users || users.length === 0) {
            return res.status(200).json({
                success: true,
                data: [],
                pagination: {
                    currentPage: page,
                    totalPages: 0,
                    totalUsers: 0,
                    limit,
                    hasNextPage: false,
                    hasPrevPage: false
                }
            });
        }

        return res.status(200).json({
            success: true,
            data: users,
            pagination: {
                currentPage: page,
                totalPages,
                totalUsers,
                limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        });

    } catch (error) {
        console.error("Error fetching users:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error while fetching users.",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
};

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
      await Session.deleteMany({userId})
      await User.findByIdAndUpdate(userId , { deleted : true}) //soft delete 
    
  } catch (error) {
    next(error)
    }}    


export const logout = async (req, res)=>{
    const{sid} = req.signedCookies
    await Session.findByIdAndDelete(sid)  

    res.clearCookie("sid") // this will clear the coookie ie the user id we have set and user will be logout
    res.status(204).end();
}

