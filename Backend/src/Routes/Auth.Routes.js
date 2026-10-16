import express from "express"
import { otpsent, otpverify } from "../Controllers/AuthController.js"
import { loginwithGoogle } from "../Controllers/Auth.Controller.js"


const router = express.Router()

router.post("/send-otp", otpsent )
router.post("/verify-otp", otpverify )
router.post("/google", loginwithGoogle)






export default router