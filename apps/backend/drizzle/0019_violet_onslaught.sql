ALTER TABLE "order_items" ADD COLUMN "fired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fire_mode" varchar(20) DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_fire_mode_check" CHECK ("orders"."fire_mode" IN ('all', 'by_course'));