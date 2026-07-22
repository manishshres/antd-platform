CREATE TABLE "category_to_modifiers" (
	"category_id" uuid NOT NULL,
	"modifier_id" uuid NOT NULL,
	CONSTRAINT "category_to_modifiers_category_id_modifier_id_pk" PRIMARY KEY("category_id","modifier_id")
);
--> statement-breakpoint
ALTER TABLE "category_to_modifiers" ADD CONSTRAINT "category_to_modifiers_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_to_modifiers" ADD CONSTRAINT "category_to_modifiers_modifier_id_menu_modifiers_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "public"."menu_modifiers"("id") ON DELETE cascade ON UPDATE no action;
