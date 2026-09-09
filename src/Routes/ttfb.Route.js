import express from "express";
import { allRegionttfbFinder, ttfbFinder } from "../Controllers/ttfb.Controller.js";

const router = express.Router();

router.post("/find", ttfbFinder);
router.post("/findAll", allRegionttfbFinder);


export default router;