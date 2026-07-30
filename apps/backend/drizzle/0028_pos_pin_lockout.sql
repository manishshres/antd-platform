-- N3: POS manager PINs were brute-forceable — the PIN endpoints skipped throttling
-- entirely and nothing tracked failed attempts. Track PIN failures separately from the
-- password lockout so a PIN attack cannot lock a user out of the dashboard.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pos_pin_failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pos_pin_locked_until" timestamp with time zone;
