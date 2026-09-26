-- AlterTable
ALTER TABLE "service_rates" ADD COLUMN     "is_system_generated" BOOLEAN NOT NULL DEFAULT false;

-- Backfill the two existing internal accommodation-billing rows so they stop
-- appearing in human-facing service pickers immediately, not just for rows
-- created after this migration.
UPDATE "service_rates" SET "is_system_generated" = true
WHERE "code" IN ('ROOM-ACC', 'WARD-PRICE', 'WARD-FIXED');
