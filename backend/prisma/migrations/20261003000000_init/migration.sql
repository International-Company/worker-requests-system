-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SYSTEM_ADMIN', 'MANAGER', 'WORKER');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TargetType" AS ENUM ('SINGLE', 'MULTIPLE', 'ALL');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_REQUEST', 'REMINDER', 'REQUEST_UPDATED', 'REQUEST_CANCELLED', 'REQUEST_REOPENED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "pin_hash" VARCHAR(64),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_profiles" (
    "user_id" UUID NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "photo" BYTEA,
    "photo_mime" VARCHAR(32),
    "photo_etag" VARCHAR(64),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "worker_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_key" VARCHAR(64) NOT NULL,
    "label" VARCHAR(160),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "bound_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" VARCHAR(40),
    "last_seen_at" TIMESTAMPTZ(3),

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "device_row_id" UUID NOT NULL,
    "endpoint" VARCHAR(1024) NOT NULL,
    "p256dh" VARCHAR(256) NOT NULL,
    "auth" VARCHAR(128) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_success_at" TIMESTAMPTZ(3),
    "disabled_at" TIMESTAMPTZ(3),
    "disabled_reason" VARCHAR(60),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_row_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requests" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "target_type" "TargetType" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotency_key" VARCHAR(64) NOT NULL,
    "resent_from_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "edited_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_recipients" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'NEW',
    "state_version" INTEGER NOT NULL DEFAULT 1,
    "delivered_at" TIMESTAMPTZ(3),
    "opened_at" TIMESTAMPTZ(3),
    "acknowledged_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "reopened_at" TIMESTAMPTZ(3),
    "last_notified_at" TIMESTAMPTZ(3),
    "reminder_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "request_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_attachments" (
    "id" UUID NOT NULL,
    "request_id" UUID,
    "uploaded_by_id" UUID NOT NULL,
    "client_upload_id" VARCHAR(64) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "mime_type" VARCHAR(32) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "data" BYTEA NOT NULL,
    "thumbnail" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_row_id" UUID,
    "type" "NotificationType" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "error" VARCHAR(300),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presence" (
    "user_id" UUID NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "location_at" TIMESTAMPTZ(3),

    CONSTRAINT "presence_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_role" "Role",
    "action" VARCHAR(60) NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" VARCHAR(64),
    "metadata" JSONB,
    "ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "session_id" UUID,
    "device_key" VARCHAR(64),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_pin_hash_key" ON "users"("pin_hash");

-- CreateIndex
CREATE INDEX "users_role_is_active_idx" ON "users"("role", "is_active");

-- CreateIndex
CREATE INDEX "devices_user_id_is_active_idx" ON "devices"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "devices_device_key_idx" ON "devices"("device_key");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_device_row_id_is_active_idx" ON "push_subscriptions"("device_row_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "requests_number_key" ON "requests"("number");

-- CreateIndex
CREATE INDEX "requests_created_by_id_created_at_idx" ON "requests"("created_by_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "requests_created_at_idx" ON "requests"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "requests_created_by_id_idempotency_key_key" ON "requests"("created_by_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "request_recipients_worker_id_updated_at_idx" ON "request_recipients"("worker_id", "updated_at");

-- CreateIndex
CREATE INDEX "request_recipients_status_opened_at_last_notified_at_idx" ON "request_recipients"("status", "opened_at", "last_notified_at");

-- CreateIndex
CREATE UNIQUE INDEX "request_recipients_request_id_worker_id_key" ON "request_recipients"("request_id", "worker_id");

-- CreateIndex
CREATE INDEX "request_attachments_request_id_position_idx" ON "request_attachments"("request_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "request_attachments_uploaded_by_id_client_upload_id_key" ON "request_attachments"("uploaded_by_id", "client_upload_id");

-- CreateIndex
CREATE INDEX "notifications_recipient_id_created_at_idx" ON "notifications"("recipient_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_status_next_attempt_at_idx" ON "notifications"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "login_logs_created_at_idx" ON "login_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "login_logs_user_id_created_at_idx" ON "login_logs"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "worker_profiles" ADD CONSTRAINT "worker_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_device_row_id_fkey" FOREIGN KEY ("device_row_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_row_id_fkey" FOREIGN KEY ("device_row_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_resent_from_id_fkey" FOREIGN KEY ("resent_from_id") REFERENCES "requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_recipients" ADD CONSTRAINT "request_recipients_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_recipients" ADD CONSTRAINT "request_recipients_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "request_recipients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_device_row_id_fkey" FOREIGN KEY ("device_row_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presence" ADD CONSTRAINT "presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_logs" ADD CONSTRAINT "login_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_logs" ADD CONSTRAINT "login_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written integrity rules (not expressible in schema.prisma)
-- ---------------------------------------------------------------------------

-- Request titles cannot be blank; max 3 images per request (positions 0..2).
ALTER TABLE "requests" ADD CONSTRAINT "requests_title_not_blank" CHECK (length(btrim("title")) > 0);
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_position_range" CHECK ("position" BETWEEN 0 AND 2);
CREATE UNIQUE INDEX "request_attachments_request_position_key"
  ON "request_attachments" ("request_id", "position") WHERE "request_id" IS NOT NULL;

-- PIN hashes are hex HMAC-SHA256 values (never a raw 4-digit PIN).
ALTER TABLE "users" ADD CONSTRAINT "users_pin_hash_format" CHECK ("pin_hash" IS NULL OR "pin_hash" ~ '^[0-9a-f]{64}$');

-- Audit and login logs are append-only: no role (including the application) may change or delete them.
CREATE FUNCTION "forbid_log_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "forbid_log_mutation"();
CREATE TRIGGER "login_logs_append_only" BEFORE UPDATE OR DELETE ON "login_logs"
  FOR EACH ROW EXECUTE FUNCTION "forbid_log_mutation"();
