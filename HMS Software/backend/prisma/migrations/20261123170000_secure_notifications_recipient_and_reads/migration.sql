-- AlterTable
ALTER TABLE "hospital_notifications" ADD COLUMN IF NOT EXISTS "recipient_user_id" TEXT,
ADD COLUMN IF NOT EXISTS "is_broadcast" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "hospital_notifications_recipient_user_id_is_read_idx" ON "hospital_notifications"("recipient_user_id", "is_read");
CREATE INDEX IF NOT EXISTS "hospital_notifications_target_portal_is_broadcast_idx" ON "hospital_notifications"("target_portal", "is_broadcast");

-- CreateTable
CREATE TABLE IF NOT EXISTS "hospital_notification_reads" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hospital_notification_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "hospital_notification_reads_notification_id_user_id_key" ON "hospital_notification_reads"("notification_id", "user_id");
CREATE INDEX IF NOT EXISTS "hospital_notification_reads_user_id_idx" ON "hospital_notification_reads"("user_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hospital_notifications_recipient_user_id_fkey') THEN
        ALTER TABLE "hospital_notifications" ADD CONSTRAINT "hospital_notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hospital_notification_reads_notification_id_fkey') THEN
        ALTER TABLE "hospital_notification_reads" ADD CONSTRAINT "hospital_notification_reads_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "hospital_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hospital_notification_reads_user_id_fkey') THEN
        ALTER TABLE "hospital_notification_reads" ADD CONSTRAINT "hospital_notification_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
