-- Refunds are negative payment rows (drawer math nets them out); the original
-- check only allowed positive amounts. drizzle-kit does not diff check-constraint
-- expressions, so this change is a hand-written migration.
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_amount_check";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("payments"."amount" <> 0);
