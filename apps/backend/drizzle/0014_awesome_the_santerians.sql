ALTER TABLE "orders" ADD COLUMN "client_order_id" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "idx_orders_org_client_id" UNIQUE("organization_id","client_order_id");