-- CreateEnum
CREATE TYPE "Role" AS ENUM ('User', 'Admin');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('free', 'pro');

-- CreateEnum
CREATE TYPE "Region" AS ENUM ('india', 'europe', 'usa');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "LighthouseStrategy" AS ENUM ('mobile', 'desktop', 'both');

-- CreateEnum
CREATE TYPE "MonitorInterval" AS ENUM ('1m', '5m', '10m', '30m', '1h');

-- CreateEnum
CREATE TYPE "MonitorStatus" AS ENUM ('active', 'paused');

-- CreateEnum
CREATE TYPE "DemoService" AS ENUM ('ttfb', 'lighthouse', 'whois', 'dns', 'redirect');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password" TEXT,
    "picture" TEXT NOT NULL DEFAULT 'https://static.vecteezy.com/system/resources/previews/002/318/271/non_2x/user-profile-icon-free-vector.jpg',
    "role" "Role" NOT NULL DEFAULT 'User',
    "plans" "Plan" NOT NULL DEFAULT 'free',
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT (now() + interval '7 days'),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OTP" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "otpHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT (now() + interval '10 minutes'),

    CONSTRAINT "OTP_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ttfb" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "guestId" VARCHAR(255),
    "roomId" VARCHAR(255) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "region" "Region" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "result" JSONB,
    "error" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ttfb_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DnsRecord" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "guestId" VARCHAR(255),
    "roomId" VARCHAR(255) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "result" JSONB,
    "error" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DnsRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhoisLookup" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "guestId" VARCHAR(255),
    "roomId" VARCHAR(255) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "result" JSONB,
    "error" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhoisLookup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedirectCheck" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "guestId" VARCHAR(255),
    "roomId" VARCHAR(255) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "result" JSONB,
    "error" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RedirectCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lighthouse" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "guestId" VARCHAR(255),
    "roomId" VARCHAR(255) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "strategy" "LighthouseStrategy" NOT NULL DEFAULT 'mobile',
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "data" TEXT,
    "result" JSONB,
    "error" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lighthouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UptimeMonitor" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "interval" "MonitorInterval" NOT NULL DEFAULT '5m',
    "status" "MonitorStatus" NOT NULL DEFAULT 'active',
    "hostinginfo" JSONB,
    "lastResult" JSONB,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UptimeMonitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UptimeResult" (
    "id" BIGSERIAL NOT NULL,
    "monitorId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UptimeResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestDemoUsage" (
    "id" SERIAL NOT NULL,
    "guestId" VARCHAR(255) NOT NULL,
    "day" VARCHAR(10) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestDemoUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestDemoUsageHistory" (
    "id" SERIAL NOT NULL,
    "usageId" INTEGER NOT NULL,
    "reservationId" VARCHAR(255),
    "service" "DemoService" NOT NULL,
    "url" VARCHAR(2048),
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestDemoUsageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OTP_email_key" ON "OTP"("email");

-- CreateIndex
CREATE INDEX "OTP_expiresAt_idx" ON "OTP"("expiresAt");

-- CreateIndex
CREATE INDEX "Ttfb_userId_createdAt_idx" ON "Ttfb"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Ttfb_guestId_createdAt_idx" ON "Ttfb"("guestId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Ttfb_roomId_idx" ON "Ttfb"("roomId");

-- CreateIndex
CREATE INDEX "Ttfb_status_createdAt_idx" ON "Ttfb"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Ttfb_createdAt_idx" ON "Ttfb"("createdAt");

-- CreateIndex
CREATE INDEX "DnsRecord_userId_createdAt_idx" ON "DnsRecord"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DnsRecord_guestId_createdAt_idx" ON "DnsRecord"("guestId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DnsRecord_roomId_idx" ON "DnsRecord"("roomId");

-- CreateIndex
CREATE INDEX "DnsRecord_status_createdAt_idx" ON "DnsRecord"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DnsRecord_createdAt_idx" ON "DnsRecord"("createdAt");

-- CreateIndex
CREATE INDEX "WhoisLookup_userId_createdAt_idx" ON "WhoisLookup"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WhoisLookup_guestId_createdAt_idx" ON "WhoisLookup"("guestId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WhoisLookup_roomId_idx" ON "WhoisLookup"("roomId");

-- CreateIndex
CREATE INDEX "WhoisLookup_status_createdAt_idx" ON "WhoisLookup"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WhoisLookup_createdAt_idx" ON "WhoisLookup"("createdAt");

-- CreateIndex
CREATE INDEX "RedirectCheck_userId_createdAt_idx" ON "RedirectCheck"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "RedirectCheck_guestId_createdAt_idx" ON "RedirectCheck"("guestId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "RedirectCheck_roomId_idx" ON "RedirectCheck"("roomId");

-- CreateIndex
CREATE INDEX "RedirectCheck_status_createdAt_idx" ON "RedirectCheck"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RedirectCheck_createdAt_idx" ON "RedirectCheck"("createdAt");

-- CreateIndex
CREATE INDEX "Lighthouse_userId_createdAt_idx" ON "Lighthouse"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Lighthouse_guestId_createdAt_idx" ON "Lighthouse"("guestId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Lighthouse_roomId_idx" ON "Lighthouse"("roomId");

-- CreateIndex
CREATE INDEX "Lighthouse_status_createdAt_idx" ON "Lighthouse"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Lighthouse_createdAt_idx" ON "Lighthouse"("createdAt");

-- CreateIndex
CREATE INDEX "UptimeMonitor_status_interval_lastCheckedAt_idx" ON "UptimeMonitor"("status", "interval", "lastCheckedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UptimeMonitor_userId_url_key" ON "UptimeMonitor"("userId", "url");

-- CreateIndex
CREATE INDEX "UptimeResult_monitorId_checkedAt_idx" ON "UptimeResult"("monitorId", "checkedAt" DESC);

-- CreateIndex
CREATE INDEX "UptimeResult_userId_checkedAt_idx" ON "UptimeResult"("userId", "checkedAt" DESC);

-- CreateIndex
CREATE INDEX "UptimeResult_checkedAt_idx" ON "UptimeResult"("checkedAt");

-- CreateIndex
CREATE INDEX "GuestDemoUsage_expiresAt_idx" ON "GuestDemoUsage"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GuestDemoUsage_guestId_day_key" ON "GuestDemoUsage"("guestId", "day");

-- CreateIndex
CREATE INDEX "GuestDemoUsageHistory_usageId_idx" ON "GuestDemoUsageHistory"("usageId");

-- CreateIndex
CREATE INDEX "GuestDemoUsageHistory_reservationId_idx" ON "GuestDemoUsageHistory"("reservationId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ttfb" ADD CONSTRAINT "Ttfb_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DnsRecord" ADD CONSTRAINT "DnsRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhoisLookup" ADD CONSTRAINT "WhoisLookup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedirectCheck" ADD CONSTRAINT "RedirectCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lighthouse" ADD CONSTRAINT "Lighthouse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UptimeMonitor" ADD CONSTRAINT "UptimeMonitor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UptimeResult" ADD CONSTRAINT "UptimeResult_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "UptimeMonitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UptimeResult" ADD CONSTRAINT "UptimeResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestDemoUsageHistory" ADD CONSTRAINT "GuestDemoUsageHistory_usageId_fkey" FOREIGN KEY ("usageId") REFERENCES "GuestDemoUsage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
