import express from "express";

import { dnsRecordLookup } from "../Controllers/dnsRecord.Controller.js";

const router = express.Router();

router.post("/lookup", dnsRecordLookup);

export default router;
