ALTER TABLE "menu_items" ADD COLUMN "is_combo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "tax_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "stock_quantity" integer;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "low_stock_threshold" integer;