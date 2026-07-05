ALTER TABLE "locations" ADD COLUMN "tax_rate_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "subtotal" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tax_amount" integer;