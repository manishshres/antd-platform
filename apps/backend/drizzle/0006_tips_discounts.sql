CREATE TABLE "discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid,
	"name" varchar(255) NOT NULL,
	"code" varchar(50),
	"type" varchar(10) NOT NULL,
	"value" integer NOT NULL,
	"requires_manager" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discounts_type_check" CHECK ("discounts"."type" IN ('percent', 'fixed')),
	CONSTRAINT "discounts_value_check" CHECK ("discounts"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tip_amount" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_amount" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_name" varchar(255);--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_discounts_organization_id" ON "discounts" USING btree ("organization_id");