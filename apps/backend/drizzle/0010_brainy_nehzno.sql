ALTER TABLE "payments" DROP CONSTRAINT "payments_amount_check";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pos_pin_hash" varchar(255);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("payments"."amount" != 0);