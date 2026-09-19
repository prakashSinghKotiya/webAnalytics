import z from "zod";
import OTP from "../Models/Otp.Model";
import { sendOtp } from "../Services/SenddOtp.Service";
import { otpSchema } from "../Validators/ZodSchema";


export const otpsent = async (req, res, next )=>{
    const {email}= req.body
    const ootipii = await sendOtp(email)
    console.log(ootipii)
      res.status(201).json(ootipii);

}


export const otpverify = async (req, res, next )=>{
  console.log(req.body)
   const {success , data , error} = otpSchema.safeParse(req.body) //sanitizing db inputs
  
      if(!success){
          return res.status(400).json({error: z.flattenError(error).fieldErrors})
      }
    const {email,otp}= data 


   const result= await OTP.find({email,otp}).lean()
   if(!result){
    return res.status(400).json({error: " invalid otp "})
   }
   
   return res.json({ message: "OTP Verified!" });

}

