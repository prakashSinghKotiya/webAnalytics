import express from "express";
import {
  allRegionttfbFinder,
  getTtfbById,
  getTtfbResults,
  ttfbFinder,
} from "../Controllers/ttfb.Controller.js";

const router = express.Router();

router.post("/find", ttfbFinder);
router.post("/findAll", allRegionttfbFinder);
router.get("/results", getTtfbResults);
router.get("/result/:id", getTtfbById);

export default router;