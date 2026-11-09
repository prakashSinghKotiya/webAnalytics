-- CreateEnum
CREATE TYPE "EnquiryTopic" AS ENUM ('support', 'enterprise', 'feature', 'billing', 'general');

-- AlterTable
ALTER TABLE "OTP" ALTER COLUMN "expiresAt" SET DEFAULT (now() + interval '10 minutes');

-- AlterTable
ALTER TABLE "Session" ALTER COLUMN "expiresAt" SET DEFAULT (now() + interval '7 days');

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "enquiryTopic" "EnquiryTopic" NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactMessage_createdAt_idx" ON "ContactMessage"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "ContactMessage_enquiryTopic_createdAt_idx" ON "ContactMessage"("enquiryTopic", "createdAt" DESC);



CREATE OR REPLACE FUNCTION cleanup_expired_rows(batch_size integer DEFAULT 10000)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  tbls text[]      := ARRAY['Ttfb','DnsRecord','WhoisLookup','RedirectCheck','Lighthouse',
                            'Session','OTP','GuestDemoUsage','UptimeResult','ContactMessage'];
  cols text[]      := ARRAY['createdAt','createdAt','createdAt','createdAt','createdAt',
                            'expiresAt','expiresAt','expiresAt','checkedAt','createdAt'];
  grace interval[] := ARRAY[interval '1 day', interval '1 day', interval '1 day',
                            interval '1 day', interval '1 day',
                            interval '0', interval '0', interval '0',
                            interval '30 days', interval '2 days'];
  i integer;
  deleted_rows bigint;
  total_deleted bigint := 0;
BEGIN
  IF batch_size <= 0 THEN
    RAISE EXCEPTION 'batch_size must be greater than zero';
  END IF;

  FOR i IN 1 .. array_length(tbls, 1) LOOP
    EXECUTE format(
      'DELETE FROM %1$I WHERE id IN (SELECT id FROM %1$I WHERE %2$I < now() - $1 LIMIT $2)',
      tbls[i], cols[i]
    ) USING grace[i], batch_size;

    GET DIAGNOSTICS deleted_rows = ROW_COUNT;
    total_deleted := total_deleted + deleted_rows;
  END LOOP;

  RETURN total_deleted;
END;
$$;