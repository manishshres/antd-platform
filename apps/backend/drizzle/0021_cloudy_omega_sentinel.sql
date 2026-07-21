ALTER TABLE "menu_items" ADD COLUMN "sku" varchar(64);--> statement-breakpoint
CREATE INDEX "idx_menu_items_sku" ON "menu_items" USING btree ("sku");