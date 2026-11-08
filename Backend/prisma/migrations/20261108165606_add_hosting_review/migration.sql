-- AlterTable
ALTER TABLE "OTP" ALTER COLUMN "expiresAt" SET DEFAULT (now() + interval '10 minutes');

-- AlterTable
ALTER TABLE "Session" ALTER COLUMN "expiresAt" SET DEFAULT (now() + interval '7 days');

-- CreateTable
CREATE TABLE "HostingReview" (
    "id" SERIAL NOT NULL,
    "providerKey" VARCHAR(255) NOT NULL,
    "providerName" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(280) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "reviewText" TEXT NOT NULL,
    "rating" DOUBLE PRECISION,
    "pros" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "extra" JSONB,
    "stats" JSONB NOT NULL,
    "statsUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "adminId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostingReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HostingReview_providerKey_key" ON "HostingReview"("providerKey");

-- CreateIndex
CREATE UNIQUE INDEX "HostingReview_slug_key" ON "HostingReview"("slug");

-- CreateIndex
CREATE INDEX "HostingReview_isPublished_publishedAt_idx" ON "HostingReview"("isPublished", "publishedAt" DESC);

-- AddForeignKey
ALTER TABLE "HostingReview" ADD CONSTRAINT "HostingReview_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
