import express from "express";
import {
  redirectCheckController,
  getRedirectCheckResults,
} from "../Controllers/redirectCheck.Controller.js";

const router = express.Router();

router.post("/check", redirectCheckController);
router.get("/results", getRedirectCheckResults);

export default router;
