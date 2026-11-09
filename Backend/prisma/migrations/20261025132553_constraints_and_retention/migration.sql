-- AlterTable
ALTER TABLE "OTP" ALTER COLUMN "expiresAt" SET DEFAULT (now() + interval '10 minutes');

-- AlterTable
ALTER TABLE "Session" ALTER COLUMN "expiresAt" SET DEFAULT (now() + interval '7 days');



-- =============================================================================
-- Custom migration: DB-level constraints + batched retention cleanup.
--
-- Usage (after your first `prisma migrate dev --name init`):
--   npx prisma migrate dev --create-only --name constraints_and_retention
--   -> paste this file's contents into the generated migration.sql
--   npx prisma migrate dev
-- =============================================================================

-- ---- Constraints Prisma cannot express --------------------------------------

ALTER TABLE "GuestDemoUsage"
  ADD CONSTRAINT guest_demo_count_non_negative CHECK ("count" >= 0),
  ADD CONSTRAINT guest_demo_day_format CHECK ("day" ~ '^\d{4}-\d{2}-\d{2}$');

ALTER TABLE "OTP"
  ADD CONSTRAINT otp_attempts_non_negative CHECK ("attempts" >= 0);

-- ---- Batched retention cleanup ----------------------------------------------
-- A PROCEDURE (not a function) so it can COMMIT between batches. This keeps
-- locks short and avoids one giant transaction / table bloat spike.
-- It must be invoked outside an explicit transaction block:
--   CALL cleanup_expired_rows();
--
-- Cutoff rule per table: "<column>" < now() - <grace> 
--   createdAt tables use their retention window as <grace>
--   expiresAt tables use 0 (delete once expired)

CREATE OR REPLACE PROCEDURE cleanup_expired_rows(batch_size integer DEFAULT 10000)
LANGUAGE plpgsql
AS $$
DECLARE
  tbls text[]     := ARRAY['Ttfb','DnsRecord','WhoisLookup','RedirectCheck','Lighthouse',
                           'Session','OTP','GuestDemoUsage','UptimeResult'];
  cols text[]     := ARRAY['createdAt','createdAt','createdAt','createdAt','createdAt',
                           'expiresAt','expiresAt','expiresAt','checkedAt'];
  grace interval[] := ARRAY[interval '1 day', interval '1 day', interval '1 day',
                            interval '1 day', interval '1 day',
                            interval '0', interval '0', interval '0',
                            interval '30 days'];
  i integer;
  deleted_rows bigint;
BEGIN

IF batch_size <= 0 THEN
  RAISE EXCEPTION 'batch_size must be greater than zero';
END IF;

  FOR i IN 1 .. array_length(tbls, 1) LOOP
    LOOP
      EXECUTE format(
        'DELETE FROM %1$I WHERE id IN (SELECT id FROM %1$I WHERE %2$I < now() - $1 LIMIT $2)',
        tbls[i], cols[i]
      ) USING grace[i], batch_size;

      GET DIAGNOSTICS deleted_rows = ROW_COUNT;
      COMMIT;
      EXIT WHEN deleted_rows < batch_size;
    END LOOP;
  END LOOP;
END;
$$;

-- ---- Scheduling (pick ONE) --------------------------------------------------
-- A) pg_cron (if your host supports it, e.g. Supabase / RDS):
--      SELECT cron.schedule('cleanup-expired-rows', '*/10 * * * *', 'CALL cleanup_expired_rows()');
--
-- B) node-cron in your backend:
--      cron.schedule('*/10 * * * *', () => prisma.$executeRawUnsafe('CALL cleanup_expired_rows()'));
