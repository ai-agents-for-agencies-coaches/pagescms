CREATE TABLE "analytics_heatmap_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"keyword_id" integer NOT NULL,
	"run_date" text NOT NULL,
	"summary" jsonb NOT NULL,
	"grid" jsonb NOT NULL,
	"error_reason" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_site_keyword" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"keyword" text NOT NULL,
	"place_id" text,
	"lat" text,
	"lng" text,
	"grid_size" integer DEFAULT 5 NOT NULL,
	"radius" integer DEFAULT 5 NOT NULL,
	"radius_units" text DEFAULT 'km' NOT NULL,
	"shape" text DEFAULT 'square' NOT NULL,
	"zoom" integer DEFAULT 13 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_heatmap_run" ADD CONSTRAINT "analytics_heatmap_run_site_id_analytics_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."analytics_site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_heatmap_run" ADD CONSTRAINT "analytics_heatmap_run_keyword_id_analytics_site_keyword_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."analytics_site_keyword"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_site_keyword" ADD CONSTRAINT "analytics_site_keyword_site_id_analytics_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."analytics_site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_analytics_heatmap_run" ON "analytics_heatmap_run" USING btree ("site_id","keyword_id","run_date");--> statement-breakpoint
CREATE INDEX "idx_analytics_heatmap_run_siteId_date" ON "analytics_heatmap_run" USING btree ("site_id","run_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_analytics_site_keyword" ON "analytics_site_keyword" USING btree ("site_id","keyword");--> statement-breakpoint
CREATE INDEX "idx_analytics_site_keyword_enabled" ON "analytics_site_keyword" USING btree ("enabled");