-- DropForeignKey
ALTER TABLE "beds" DROP CONSTRAINT IF EXISTS "beds_room_id_fkey";

-- DropForeignKey
ALTER TABLE "beds" DROP CONSTRAINT IF EXISTS "beds_ward_id_fkey";

-- DropForeignKey
ALTER TABLE "hospital_invoices" DROP CONSTRAINT IF EXISTS "hospital_invoices_corporate_panel_id_fkey";

-- DropForeignKey
ALTER TABLE "rooms" DROP CONSTRAINT IF EXISTS "rooms_ward_id_fkey";

-- AlterTable
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "fixed_price" DECIMAL(14,2),
ADD COLUMN IF NOT EXISTS "floor" TEXT;

-- AlterTable
ALTER TABLE "service_rates" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "wards" ADD COLUMN IF NOT EXISTS "fixed_price" DECIMAL(14,2),
ADD COLUMN IF NOT EXISTS "head_staff_id" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "hospital_floors" (
    "id" TEXT NOT NULL,
    "floor_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "building" TEXT DEFAULT 'Main Building',
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hospital_floors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "hospital_notifications" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'info',
    "module" TEXT NOT NULL DEFAULT 'General',
    "target_portal" TEXT,
    "action_url" TEXT,
    "reference_id" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,

    CONSTRAINT "hospital_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "hospital_floors_name_key" ON "hospital_floors"("name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "hospital_notifications_target_portal_is_read_idx" ON "hospital_notifications"("target_portal", "is_read");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "hospital_notifications_created_at_idx" ON "hospital_notifications"("created_at");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wards_head_staff_id_fkey') THEN
        ALTER TABLE "wards" ADD CONSTRAINT "wards_head_staff_id_fkey" FOREIGN KEY ("head_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rooms_ward_id_fkey') THEN
        ALTER TABLE "rooms" ADD CONSTRAINT "rooms_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds_room_id_fkey') THEN
        ALTER TABLE "beds" ADD CONSTRAINT "beds_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds_ward_id_fkey') THEN
        ALTER TABLE "beds" ADD CONSTRAINT "beds_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hospital_invoices_corporate_panel_id_fkey') THEN
        ALTER TABLE "hospital_invoices" ADD CONSTRAINT "hospital_invoices_corporate_panel_id_fkey" FOREIGN KEY ("corporate_panel_id") REFERENCES "corporate_panels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
