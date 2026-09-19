 import nodemailer from "nodemailer";
import OTP from "../Models/Otp.Model";


export async function sendOtp(email){
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

      await OTP.findOneAndUpdate( // this is for if user repeateddly use sendotp button the otp doctument wont multiply insteed it will append new otp on that very session 
        { email },
        { otp, createdAt: new Date() },
        { upsert: true } // uperset wil create new if not available or update if available
      );

  const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
  pass: process.env.EMAIL_PASS,

  },
});

const html = `
    <div style="font-family:sans-serif;">
      <h2>Your OTP is: ${otp}</h2>
      <p>This OTP is valid for 10 minutes.</p>
    </div>
  `;

const info = await transporter.sendMail({
  from: "storage app <prakashkotya100@gmail.com>",
  to: email,
  subject: "Storage app otp",
  html
});

return { success: true, message: `OTP sent successfully on ${email}` };

}

// we dont use this actull for otp we use resend for that but it need domain we dont have rn so we are using nodemailer 