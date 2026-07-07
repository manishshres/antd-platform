ALTER TABLE "menu_modifiers" ADD COLUMN "multi_select" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_modifiers" ADD COLUMN "max_selections" integer;