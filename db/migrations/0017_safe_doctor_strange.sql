CREATE TABLE "indexing_ping" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"netlify_deploy_id" text,
	"provider" text NOT NULL,
	"sitemap_url" text NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "indexing_ping" ADD CONSTRAINT "indexing_ping_site_id_analytics_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."analytics_site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_indexing_ping_site_created" ON "indexing_ping" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_indexing_ping_deploy" ON "indexing_ping" USING btree ("netlify_deploy_id");