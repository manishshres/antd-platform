ALTER TABLE "locations" ADD COLUMN "service_charge_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "service_charge_amount" integer;