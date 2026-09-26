import express from "express"
import checkAuth, { adminChecker, isAdmin } from "../Middleware/authentication.Mw.js"
import { adminPowerlogout, DeleteUser, getAllUsers } from "../Controllers/User.Controller.js"






const router = express.Router()



router.get("/getusers",checkAuth,adminChecker, getAllUsers) //rbac 

router.post("/:userId/logout",checkAuth,adminChecker,adminPowerlogout ) //rbac

router.post("/:userId",checkAuth,isAdmin,DeleteUser) //rbac


 

export default router