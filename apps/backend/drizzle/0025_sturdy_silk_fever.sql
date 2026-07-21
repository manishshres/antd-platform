ALTER TABLE "customers" ADD COLUMN "loyalty_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "loyalty_points_earned" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "loyalty_points_redeemed" integer;