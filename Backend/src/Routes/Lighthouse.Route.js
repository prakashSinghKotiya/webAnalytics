import express from "express";
import {
  getLighthouseById,
  getLighthouseResults,
  LighthouseResult,
} from "../Controllers/lighthouse.Controller.js";

const router = express.Router();

router.post("/report", LighthouseResult);
router.get("/results", getLighthouseResults);
router.get("/result/:id", getLighthouseById);

export default router;