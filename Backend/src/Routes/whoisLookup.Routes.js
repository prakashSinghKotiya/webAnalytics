import express from "express";
import {
  whoisLookupController,
  getWhoisLookupResults,
} from "../Controllers/whoisLookup.Controller.js";

const router = express.Router();

router.post("/lookup", whoisLookupController);
router.get("/results", getWhoisLookupResults);

export default router;
