ALTER TABLE "payments" DROP CONSTRAINT "payments_method_check";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "method" SET DATA TYPE varchar(20);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_check" CHECK ("payments"."method" IN ('cash', 'card', 'gift_card', 'store_credit', 'other'));