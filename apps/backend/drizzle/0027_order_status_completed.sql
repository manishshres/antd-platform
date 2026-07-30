-- N1: the order state machine writes 'completed' but orders_status_check only allowed
-- 'delivered', so every ready -> completed transition violated the constraint and 500'd.
-- 'completed' is canonical (dashboard status maps + POS use it); rewrite legacy rows.

ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_status_check";--> statement-breakpoint
UPDATE "orders" SET "status" = 'completed' WHERE "status" = 'delivered';--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_check" CHECK ("orders"."status" IN ('pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled', 'refunded'));
