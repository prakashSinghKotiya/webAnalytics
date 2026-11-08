import * as z from "zod";  
import { JSDOM } from 'jsdom'; 
import DOMPurify from 'dompurify';



const window = new JSDOM('').window;
const purify = DOMPurify(window); // anti xss attack 

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .pipe(z.email("enter a valid email"));


const newPasswordSchema = z
  .string()
  .min(8, "password must be at least 8 characters")
  .max(128, "password is too long");


  

export const loginSchema = z.object({  
    email : emailSchema,
    password : z.string()
})

export const registerSchema = z.object({
    name: z.string().min(3).max(100).transform((value) => purify.sanitize(value, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })) , //sanitizing name fiels using DOMpurify to  prevent xss attack 
    otp: z.string().length(4,"enter a valid otp"),
    email : emailSchema,
    password : newPasswordSchema

})

export const otpSchema = z.object({
    email: emailSchema,
    otp: z.string().length(4)
})

export const gAuthSchema = z.object({
    name: z.string(),
    email: emailSchema,
    picture: z.string().optional(),
    sub: z.string().optional(),
})


export const forgotPasswordSchema = z.object({
    email: emailSchema,
    otp: z.string().length(4, "enter a valid otp"),
    password: newPasswordSchema.optional(),
    newPassword: newPasswordSchema.optional(),
});
