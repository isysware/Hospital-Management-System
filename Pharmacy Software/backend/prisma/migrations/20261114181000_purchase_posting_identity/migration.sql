ALTER TABLE "purchases" ADD COLUMN "request_key" TEXT, ADD COLUMN "request_hash" TEXT;
CREATE UNIQUE INDEX "purchases_request_key_key" ON "purchases"("request_key");
