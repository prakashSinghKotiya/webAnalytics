import express from "express";
import { LighthouseResult } from "../Controllers/lighthouse.Controller.js";

const router = express.Router();

router.post("/report", LighthouseResult);



export default router;