CREATE TABLE "review_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"run_id" uuid NOT NULL,
	"path" text NOT NULL,
	"blob_sha" text NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_views_run_path_blob_unique" UNIQUE("run_id","path","blob_sha")
);
--> statement-breakpoint
ALTER TABLE "review_views" ADD CONSTRAINT "review_views_run_id_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id");