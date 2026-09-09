import express from "express";

import { testUptime } from "../Controllers/uptimeRobot.Controller.js";

const router = express.Router();

router.post("/find", testUptime);


export default router;