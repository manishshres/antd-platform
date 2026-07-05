ALTER TABLE "locations" ADD COLUMN "menu_last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "modifiers" jsonb;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "notes" varchar(500);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "source" varchar(20);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_method" varchar(20);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_at" timestamp;