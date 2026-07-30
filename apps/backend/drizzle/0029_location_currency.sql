-- N8: money was integer minor units everywhere but USD-implicit — no column recorded which
-- currency those units were in. Needed before any customer-facing payment processing.

ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "currency" varchar(3) DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" DROP CONSTRAINT IF EXISTS "locations_currency_check";--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_currency_check" CHECK ("locations"."currency" ~ '^[A-Z]{3}$');
