import { model, Schema } from "mongoose";

const otpSchema = new Schema({ 
   
     email: {
    type: String,
    required: true,
    unique: true,
  },
  otp: {
    type: String,
    required: true,
  },
  createdAt: { // ttl index 
    type: Date,
    default: Date.now,
    expires: 600, // otp doc will be removed after this sec 
  },

})

const OTP = model("OTP", otpSchema) 

export default OTP