ALTER TABLE "org_invitations" ALTER COLUMN "role" SET DEFAULT 'manager';--> statement-breakpoint
ALTER TABLE "print_jobs" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "menu_import_source" varchar(1024);--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "ttl_secs" integer DEFAULT 604800 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_completed_at" timestamp;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_org_created" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_orders_org_created" ON "orders" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_recordings_org_created" ON "recordings" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_usage_events_org_type_created" ON "usage_events" USING btree ("organization_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_status_check" CHECK ("locations"."status" IN ('draft', 'active', 'suspended', 'archived', 'deprovisioned', 'provisioning'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_check" CHECK ("orders"."status" IN ('pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'));--> statement-breakpoint
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_role_check" CHECK ("org_invitations"."role" IN ('user', 'manager', 'admin', 'sysadmin', 'platform_admin'));--> statement-breakpoint
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_status_check" CHECK ("org_invitations"."status" IN ('pending', 'accepted', 'expired', 'revoked'));--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_status_check" CHECK ("organizations"."status" IN ('draft', 'active', 'suspended', 'archived', 'provisioning'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" IN ('user', 'manager', 'admin', 'sysadmin', 'platform_admin'));