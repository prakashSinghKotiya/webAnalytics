import express from "express"
import checkAuth from "../Middleware/authentication.Mw"
import { loginUser, logout, registerUser, userDetails } from "../Controllers/User.Controller"
import { registerLimiter, requstThrottling } from "../Validators/RateLimiting"





const router = express.Router()


router.post("/register",registerLimiter,requstThrottling, registerUser)

router.post("/login",registerLimiter,requstThrottling ,loginUser )

router.get("/home",checkAuth, userDetails)

router.post("/logout", checkAuth, logout)



 

export default router