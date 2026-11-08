-- AlterEnum

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SuperAdmin';

-- AlterTable
ALTER TABLE "OTP" ALTER COLUMN "expiresAt" SET DEFAULT (now() + interval '10 minutes');

-- AlterTable
ALTER TABLE "Session" ALTER COLUMN "expiresAt" SET DEFAULT (now() + interval '7 days');

-- CreateTable
CREATE TABLE "RoleAuditLog" (
    "id" SERIAL NOT NULL,
    "actorId" INTEGER NOT NULL,
    "targetId" INTEGER NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "oldRole" "Role" NOT NULL,
    "newRole" "Role" NOT NULL,
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleAuditLog_actorId_idx" ON "RoleAuditLog"("actorId");

-- CreateIndex
CREATE INDEX "RoleAuditLog_targetId_idx" ON "RoleAuditLog"("targetId");

-- CreateIndex
CREATE INDEX "RoleAuditLog_createdAt_idx" ON "RoleAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "RoleAuditLog" ADD CONSTRAINT "RoleAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAuditLog" ADD CONSTRAINT "RoleAuditLog_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
