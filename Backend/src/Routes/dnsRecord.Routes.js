import express from "express";
import {
  dnsRecordLookup,
  getDnsRecordById,
  getDnsRecordResults,
} from "../Controllers/dnsRecord.Controller.js";

const router = express.Router();

router.post("/lookup", dnsRecordLookup);
router.get("/results", getDnsRecordResults);
router.get("/result/:id", getDnsRecordById);

export default router;
