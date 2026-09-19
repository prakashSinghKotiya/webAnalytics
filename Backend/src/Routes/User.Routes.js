import express from "express"
import checkAuth from "../Middleware/authentication.Mw"
import { loginUser, logout, registerUser, userDetails } from "../Controllers/User.Controller"





const router = express.Router()


router.post("/register", registerUser)

router.post("/login",loginUser )

router.get("/home",checkAuth, userDetails)

router.post("/logout", checkAuth, logout)



 

export default router