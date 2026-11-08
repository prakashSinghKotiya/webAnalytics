-- 1. Drop the existing single-active partial unique index
DROP INDEX IF EXISTS "UptimeRunner_single_active";

-- AlterTable for OTP and Session
ALTER TABLE "OTP" ALTER COLUMN "expiresAt" SET DEFAULT (now() + interval '10 minutes');
ALTER TABLE "Session" ALTER COLUMN "expiresAt" SET DEFAULT (now() + interval '7 days');

-- 2. Add the isDefault column and update isActive default
ALTER TABLE "UptimeRunner" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "isActive" SET DEFAULT true;

-- 3. Set isDefault = true on currently active runner, falling back to local runner if none active
UPDATE "UptimeRunner" SET "isDefault" = true WHERE "isActive" = true;
UPDATE "UptimeRunner" SET "isDefault" = true
WHERE NOT EXISTS (SELECT 1 FROM "UptimeRunner" WHERE "isDefault" = true)
  AND "type" = 'local';

-- 4. Set isActive = true for all existing runners
UPDATE "UptimeRunner" SET "isActive" = true;

-- 5. Create partial unique index enforcing exactly one default runner
CREATE UNIQUE INDEX "UptimeRunner_single_default" ON "UptimeRunner" ("isDefault") WHERE "isDefault" = true;

-- 6. Add runnerId column, index, and foreign key to UptimeMonitor
ALTER TABLE "UptimeMonitor" ADD COLUMN     "runnerId" INTEGER;

CREATE INDEX "UptimeMonitor_runnerId_idx" ON "UptimeMonitor"("runnerId");

ALTER TABLE "UptimeMonitor" ADD CONSTRAINT "UptimeMonitor_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "UptimeRunner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
