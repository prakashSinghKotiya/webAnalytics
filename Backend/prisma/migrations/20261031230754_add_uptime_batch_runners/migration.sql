-- CreateEnum
CREATE TYPE "RunnerType" AS ENUM ('local', 'lambda', 'http');

-- DropIndex
DROP INDEX "UptimeMonitor_status_interval_lastCheckedAt_idx";

-- AlterTable
ALTER TABLE "OTP" ALTER COLUMN "expiresAt" SET DEFAULT (now() + interval '10 minutes');

-- AlterTable
ALTER TABLE "Session" ALTER COLUMN "expiresAt" SET DEFAULT (now() + interval '7 days');

-- AlterTable
ALTER TABLE "UptimeMonitor" ADD COLUMN     "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "UptimeRunner" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "RunnerType" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UptimeRunner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UptimeRunner_name_key" ON "UptimeRunner"("name");

-- CreateIndex
CREATE INDEX "UptimeMonitor_status_nextCheckAt_idx" ON "UptimeMonitor"("status", "nextCheckAt");

-- Create partial unique index enforcing at most one active runner
CREATE UNIQUE INDEX "UptimeRunner_single_active" ON "UptimeRunner" ("isActive") WHERE "isActive" = true;

-- Spread existing monitors' nextCheckAt randomly over the next 5 minutes to avoid thundering herd
UPDATE "UptimeMonitor" SET "nextCheckAt" = NOW() + (random() * interval '5 minutes');
