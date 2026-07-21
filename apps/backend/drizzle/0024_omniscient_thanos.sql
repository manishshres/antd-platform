CREATE TABLE "time_clock_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"location_id" uuid,
	"clock_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"clock_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_clock_entries" ADD CONSTRAINT "time_clock_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_entries" ADD CONSTRAINT "time_clock_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_clock_entries" ADD CONSTRAINT "time_clock_entries_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_time_clock_entries_org" ON "time_clock_entries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_time_clock_entries_user" ON "time_clock_entries" USING btree ("user_id");