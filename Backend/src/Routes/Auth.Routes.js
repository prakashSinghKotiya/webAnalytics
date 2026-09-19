import express from "express"
import { otpsent, otpverify } from "../Controllers/AuthController"


const router = express.Router()

router.post("/send-otp", otpsent )
router.post("/verify-otp", otpverify )






export default router