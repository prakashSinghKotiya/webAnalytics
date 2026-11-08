import express from "express"
import checkAuth from "../Middleware/authentication.Mw.js"
import { loginUser, logout, registerUser, userDetails, forgotPassword, sendForgotPasswordOtp } from "../Controllers/User.Controller.js"
import { registerLimiter, requstThrottling } from "../Validators/RateLimiting.js"





const router = express.Router()


router.post("/register",registerLimiter,requstThrottling, registerUser)

router.post("/login",registerLimiter,requstThrottling ,loginUser )

router.post("/forgot-password", registerLimiter, requstThrottling, forgotPassword)
router.post("/reset-password", registerLimiter, requstThrottling, forgotPassword)
router.post("/forgot-password/send-otp", registerLimiter, requstThrottling, sendForgotPasswordOtp)
router.post("/send-otp", registerLimiter, requstThrottling, sendForgotPasswordOtp)

router.get("/home",checkAuth, userDetails)

router.post("/logout", checkAuth, logout)



 

export default router