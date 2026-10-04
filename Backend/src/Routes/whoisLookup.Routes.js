import express from "express";

import { whoisLookupController } from "../Controllers/whoisLookup.Controller.js";

const router = express.Router();

router.post("/lookup",  whoisLookupController);

export default router;
