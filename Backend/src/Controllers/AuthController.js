import z from "zod";
import { prisma } from "../config/db.prismaSQL.js";
import { sendOtp } from "../Services/SenddOtp.Service.js";
import { otpSchema } from "../Validators/ZodSchema.js";

export const otpsent = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    const ootipii = await sendOtp(email);
    console.log(ootipii);
    return res.status(201).json(ootipii);
  } catch (err) {
    console.error("otpsent error:", err);
    next(err);
  }
};

export const otpverify = async (req, res, next) => {
  try {
    console.log(req.body);
    const { success, data, error } = otpSchema.safeParse(req.body); // sanitizing db inputs

    if (!success) {
      return res.status(400).json({ error: z.flattenError(error).fieldErrors });
    }
    const { email, otp } = data;
    const normalizedEmail = email.trim().toLowerCase();

    const otpRecord = await prisma.oTP.findUnique({
      where: { email: normalizedEmail },
    });

    if (!otpRecord) {
      return res.status(400).json({ error: "invalid otp" });
    }

    if (otpRecord.attempts >= 5) {
      return res.status(400).json({ error: "too many failed attempts, please request a new otp" });
    }

    if (new Date() > otpRecord.expiresAt) {
      return res.status(400).json({ error: "otp expired, please request a new otp" });
    }

    if (otpRecord.otp !== otp) {
      await prisma.oTP.update({
        where: { email: normalizedEmail },
        data: { attempts: { increment: 1 } },
      });
      return res.status(400).json({ error: "invalid otp" });
    }

    return res.json({ message: "OTP Verified!" });
  } catch (err) {
    console.error("otpverify error:", err);
    next(err);
  }
};
