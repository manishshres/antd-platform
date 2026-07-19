CREATE INDEX "idx_order_items_menu_item_id" ON "order_items" USING btree ("menu_item_id");--> statement-breakpoint
CREATE INDEX "idx_payments_created_by" ON "payments" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_check" CHECK ("order_items"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_price_check" CHECK ("order_items"."price" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tip_amount_check" CHECK ("orders"."tip_amount" >= 0);