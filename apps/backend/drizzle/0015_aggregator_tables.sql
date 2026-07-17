CREATE TABLE "external_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid,
	"provider_id" uuid NOT NULL,
	"integration_account_id" uuid,
	"internal_order_id" uuid,
	"external_order_id" varchar(255) NOT NULL,
	"external_status" varchar(50),
	"external_created_at" timestamp,
	"raw_payload" jsonb NOT NULL,
	"sync_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error" varchar(1000),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_external_orders_provider_external" UNIQUE("provider_id","external_order_id")
);
--> statement-breakpoint
CREATE TABLE "integration_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid,
	"provider_id" uuid NOT NULL,
	"credentials" jsonb,
	"provider_store_id" varchar(255),
	"status" varchar(30) DEFAULT 'waiting' NOT NULL,
	"is_online" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"integration_account_id" uuid,
	"type" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"error" varchar(1000),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_provider_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"integration_account_id" uuid NOT NULL,
	"coneeko_menu_item_id" uuid NOT NULL,
	"external_menu_item_id" varchar(255),
	"external_category_id" varchar(255),
	"mapping_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_menu_provider_mappings_account_item" UNIQUE("integration_account_id","coneeko_menu_item_id")
);
--> statement-breakpoint
CREATE TABLE "order_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(50) NOT NULL,
	"type" varchar(20) DEFAULT 'marketplace' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_sources_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "provider_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"supports_orders" boolean DEFAULT true NOT NULL,
	"supports_menu_sync" boolean DEFAULT false NOT NULL,
	"supports_delivery" boolean DEFAULT false NOT NULL,
	"supports_status_updates" boolean DEFAULT true NOT NULL,
	"supports_refunds" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_provider_capabilities_provider" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "providers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_event_id" varchar(255),
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"response_code" integer,
	"error_message" varchar(1000),
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_status_check";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "integration_account_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "external_order_id" varchar(255);--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "event_type" varchar(100);--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "external_orders" ADD CONSTRAINT "external_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_orders" ADD CONSTRAINT "external_orders_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_orders" ADD CONSTRAINT "external_orders_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_orders" ADD CONSTRAINT "external_orders_integration_account_id_integration_accounts_id_fk" FOREIGN KEY ("integration_account_id") REFERENCES "public"."integration_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_orders" ADD CONSTRAINT "external_orders_internal_order_id_orders_id_fk" FOREIGN KEY ("internal_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_jobs" ADD CONSTRAINT "integration_sync_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_jobs" ADD CONSTRAINT "integration_sync_jobs_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_jobs" ADD CONSTRAINT "integration_sync_jobs_integration_account_id_integration_accounts_id_fk" FOREIGN KEY ("integration_account_id") REFERENCES "public"."integration_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_provider_mappings" ADD CONSTRAINT "menu_provider_mappings_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_provider_mappings" ADD CONSTRAINT "menu_provider_mappings_integration_account_id_integration_accounts_id_fk" FOREIGN KEY ("integration_account_id") REFERENCES "public"."integration_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_provider_mappings" ADD CONSTRAINT "menu_provider_mappings_coneeko_menu_item_id_menu_items_id_fk" FOREIGN KEY ("coneeko_menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_capabilities" ADD CONSTRAINT "provider_capabilities_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_event_id_webhook_events_event_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."webhook_events"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_external_orders_org" ON "external_orders" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_external_orders_internal_order" ON "external_orders" USING btree ("internal_order_id");--> statement-breakpoint
CREATE INDEX "idx_integration_accounts_org" ON "integration_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_integration_accounts_provider" ON "integration_accounts" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "idx_integration_sync_jobs_org" ON "integration_sync_jobs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_menu_provider_mappings_account" ON "menu_provider_mappings" USING btree ("integration_account_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_event" ON "webhook_deliveries" USING btree ("webhook_event_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_source_id_order_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."order_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_integration_account_id_integration_accounts_id_fk" FOREIGN KEY ("integration_account_id") REFERENCES "public"."integration_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_check" CHECK ("orders"."status" IN ('pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled', 'refunded'));