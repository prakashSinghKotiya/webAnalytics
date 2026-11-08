import express from "express"
import { otpsent, otpverify } from "../Controllers/AuthController.js"
import { loginwithGoogle } from "../Controllers/Auth.Controller.js"
import { forgotPassword, sendForgotPasswordOtp } from "../Controllers/User.Controller.js"
import { registerLimiter, requstThrottling } from "../Validators/RateLimiting.js"

const router = express.Router()

router.post("/send-otp", otpsent)
router.post("/verify-otp", otpverify)
router.post("/google", loginwithGoogle)
router.post("/forgot-password", registerLimiter, requstThrottling, forgotPassword)
router.post("/reset-password", registerLimiter, requstThrottling, forgotPassword)
router.post("/forgot-password/send-otp", registerLimiter, requstThrottling, sendForgotPasswordOtp)

export default router
