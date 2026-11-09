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

export const ALLOWED_ENQUIRY_TOPICS = [
  "support",
  "enterprise",
  "feature",
  "billing",
  "general",
];

export const contactMessageSchema = z.object({
  name: z
    .string({ required_error: "Name is required" })
    .trim()
    .min(1, "Name cannot be empty")
    .max(100, "Name cannot exceed 100 characters")
    .transform((val) => purify.sanitize(val, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim())
    .refine((val) => val.length > 0, { message: "Name cannot be empty" }),
  email: emailSchema,
  enquiryTopic: z.preprocess(
    (val) => (typeof val === "string" ? val.trim().toLowerCase() : val),
    z.enum(ALLOWED_ENQUIRY_TOPICS, {
      errorMap: () => ({
        message: "Invalid enquiry topic. Allowed topics: support, enterprise, feature, billing, general",
      }),
    })
  ),
  message: z
    .string({ required_error: "Message is required" })
    .trim()
    .min(1, "Message cannot be empty")
    .max(5000, "Message cannot exceed 5000 characters")
    .transform((val) => purify.sanitize(val, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim())
    .refine((val) => val.length > 0, { message: "Message cannot be empty" }),
});

