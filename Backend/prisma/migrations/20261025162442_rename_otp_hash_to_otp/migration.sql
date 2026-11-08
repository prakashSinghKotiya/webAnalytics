/*
  Warnings:

  - You are about to drop the column `otpHash` on the `OTP` table. All the data in the column will be lost.
  - Added the required column `otp` to the `OTP` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "OTP" DROP COLUMN "otpHash",
ADD COLUMN     "otp" TEXT NOT NULL,
ALTER COLUMN "expiresAt" SET DEFAULT (now() + interval '10 minutes');

-- AlterTable
ALTER TABLE "Session" ALTER COLUMN "expiresAt" SET DEFAULT (now() + interval '7 days');
