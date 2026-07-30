-- In-flight merchant OAuth handshakes for marketplace onboarding (Uber Eats
-- authorization_code grant). The provider's callback lands on the merchant's browser with
-- no JWT, so `state` is the only link back to an organization: it is unique (single-use)
-- and every row carries an expiry. The merchant user access token is encrypted at rest and
-- wiped once the session completes.

CREATE TABLE IF NOT EXISTS "integration_oauth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"provider_id" uuid NOT NULL,
	"location_id" uuid,
	"state" varchar(128) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"access_token" jsonb,
	"access_token_expires_at" timestamp with time zone,
	"discovered_stores" jsonb,
	"error" varchar(1000),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_oauth_sessions_state_unique" UNIQUE("state"),
	CONSTRAINT "integration_oauth_sessions_status_check" CHECK ("status" IN ('pending', 'authorized', 'completed', 'failed', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "integration_oauth_sessions" ADD CONSTRAINT "integration_oauth_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_oauth_sessions" ADD CONSTRAINT "integration_oauth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_oauth_sessions" ADD CONSTRAINT "integration_oauth_sessions_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_oauth_sessions" ADD CONSTRAINT "integration_oauth_sessions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_integration_oauth_sessions_org" ON "integration_oauth_sessions" USING btree ("organization_id");
