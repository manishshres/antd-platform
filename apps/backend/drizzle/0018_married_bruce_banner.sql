CREATE TABLE "order_mutations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"client_mutation_id" varchar(255) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idx_order_mutations_org_client_id" UNIQUE("organization_id","client_mutation_id")
);
--> statement-breakpoint
ALTER TABLE "order_mutations" ADD CONSTRAINT "order_mutations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_mutations" ADD CONSTRAINT "order_mutations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_order_mutations_order_id" ON "order_mutations" USING btree ("order_id");