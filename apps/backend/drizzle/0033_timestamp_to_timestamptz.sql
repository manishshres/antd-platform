-- Convert all timestamp columns to timestamptz (with time zone)
-- Run: npx drizzle-kit migrate --config=apps/backend/drizzle.config.ts

-- organizations
ALTER TABLE "organizations" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "organizations" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "organizations" ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

-- locations
ALTER TABLE "locations" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "locations" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "locations" ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';
ALTER TABLE "locations" ALTER COLUMN "provisioning_started_at" TYPE timestamptz USING "provisioning_started_at" AT TIME ZONE 'UTC';
ALTER TABLE "locations" ALTER COLUMN "provisioning_completed_at" TYPE timestamptz USING "provisioning_completed_at" AT TIME ZONE 'UTC';
ALTER TABLE "locations" ALTER COLUMN "menu_last_synced_at" TYPE timestamptz USING "menu_last_synced_at" AT TIME ZONE 'UTC';

-- org_invitations
ALTER TABLE "org_invitations" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "org_invitations" ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';
ALTER TABLE "org_invitations" ALTER COLUMN "accepted_at" TYPE timestamptz USING "accepted_at" AT TIME ZONE 'UTC';

-- org_provisioning_steps
ALTER TABLE "org_provisioning_steps" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "org_provisioning_steps" ALTER COLUMN "started_at" TYPE timestamptz USING "started_at" AT TIME ZONE 'UTC';
ALTER TABLE "org_provisioning_steps" ALTER COLUMN "completed_at" TYPE timestamptz USING "completed_at" AT TIME ZONE 'UTC';

-- users
ALTER TABLE "users" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "users" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "users" ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';
ALTER TABLE "users" ALTER COLUMN "email_verified_at" TYPE timestamptz USING "email_verified_at" AT TIME ZONE 'UTC';
ALTER TABLE "users" ALTER COLUMN "onboarding_completed_at" TYPE timestamptz USING "onboarding_completed_at" AT TIME ZONE 'UTC';
ALTER TABLE "users" ALTER COLUMN "last_login_at" TYPE timestamptz USING "last_login_at" AT TIME ZONE 'UTC';
ALTER TABLE "users" ALTER COLUMN "locked_until" TYPE timestamptz USING "locked_until" AT TIME ZONE 'UTC';

-- refresh_tokens
ALTER TABLE "refresh_tokens" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "refresh_tokens" ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';

-- subscriptions
ALTER TABLE "subscriptions" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "subscriptions" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "subscriptions" ALTER COLUMN "current_period_end" TYPE timestamptz USING "current_period_end" AT TIME ZONE 'UTC';

-- api_keys
ALTER TABLE "api_keys" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "api_keys" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "api_keys" ALTER COLUMN "last_used_at" TYPE timestamptz USING "last_used_at" AT TIME ZONE 'UTC';
ALTER TABLE "api_keys" ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';

-- categories
ALTER TABLE "categories" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "categories" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "categories" ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

-- menu_items
ALTER TABLE "menu_items" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "menu_items" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "menu_items" ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

-- menu_modifiers
ALTER TABLE "menu_modifiers" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "menu_modifiers" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "menu_modifiers" ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

-- menu_item_modifiers
ALTER TABLE "menu_item_modifiers" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "menu_item_modifiers" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "menu_item_modifiers" ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

-- discounts
ALTER TABLE "discounts" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "discounts" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "discounts" ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

-- customers
ALTER TABLE "customers" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "customers" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';

-- floor_plans
ALTER TABLE "floor_plans" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "floor_plans" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';

-- tables
ALTER TABLE "tables" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "tables" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';

-- orders
ALTER TABLE "orders" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "orders" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "orders" ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';
ALTER TABLE "orders" ALTER COLUMN "paid_at" TYPE timestamptz USING "paid_at" AT TIME ZONE 'UTC';

-- order_items
ALTER TABLE "order_items" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';

-- payments
ALTER TABLE "payments" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';

-- print_jobs
ALTER TABLE "print_jobs" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "print_jobs" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';

-- audit_logs
ALTER TABLE "audit_logs" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';

-- org_agents
ALTER TABLE "org_agents" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "org_agents" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "org_agents" ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

-- org_documents
ALTER TABLE "org_documents" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "org_documents" ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

-- org_phone_numbers
ALTER TABLE "org_phone_numbers" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "org_phone_numbers" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "org_phone_numbers" ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

-- printers
ALTER TABLE "printers" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "printers" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "printers" ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';
ALTER TABLE "printers" ALTER COLUMN "last_heartbeat_at" TYPE timestamptz USING "last_heartbeat_at" AT TIME ZONE 'UTC';

-- password_reset_tokens
ALTER TABLE "password_reset_tokens" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "password_reset_tokens" ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';
ALTER TABLE "password_reset_tokens" ALTER COLUMN "used_at" TYPE timestamptz USING "used_at" AT TIME ZONE 'UTC';

-- email_verification_tokens
ALTER TABLE "email_verification_tokens" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "email_verification_tokens" ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';

-- recordings
ALTER TABLE "recordings" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "recordings" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "recordings" ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';
ALTER TABLE "recordings" ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';

-- conversations
ALTER TABLE "conversations" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "conversations" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';

-- usage_events
ALTER TABLE "usage_events" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';

-- org_webhooks
ALTER TABLE "org_webhooks" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "org_webhooks" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';

-- webhook_events
ALTER TABLE "webhook_events" ALTER COLUMN "received_at" TYPE timestamptz USING "received_at" AT TIME ZONE 'UTC';
ALTER TABLE "webhook_events" ALTER COLUMN "processed_at" TYPE timestamptz USING "processed_at" AT TIME ZONE 'UTC';

-- plans (no timestamp columns to convert - only created_at/updated_at)
ALTER TABLE "plans" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "plans" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';