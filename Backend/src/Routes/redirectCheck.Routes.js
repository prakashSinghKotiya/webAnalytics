import express from "express";

import { redirectCheckController } from "../Controllers/redirectCheck.Controller.js";

const router = express.Router();

router.post("/check",  redirectCheckController);

export default router;
