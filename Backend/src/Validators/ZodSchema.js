import * as z from "zod";  
import { JSDOM } from 'jsdom'; 
import DOMPurify from 'dompurify';



const window = new JSDOM('').window;
const purify = DOMPurify(window); // anti xss attack 

export const loginSchema = z.object({  
    email : z.email("enter a valid email"),
    password : z.string()
})

export const registerSchema = z.object({
    name: z.string().min(3).max(100).transform((value) => purify.sanitize(value, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })) , //sanitizing name fiels using DOMpurify to  prevent xss attack 
    otp: z.string().length(4,"enter a valid otp"),
    email : z.email("enter a valid email"),
    password : z.string()

})

export const otpSchema = z.object({
    email: z.email(),
    otp: z.string().length(4)
})
