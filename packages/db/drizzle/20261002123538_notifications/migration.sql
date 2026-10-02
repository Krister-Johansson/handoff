CREATE TYPE "notification_tone" AS ENUM('neutral', 'success', 'attention', 'danger');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid,
	"run_id" uuid,
	"tone" "notification_tone" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_run_idx" ON "notifications" ("run_id");--> statement-breakpoint
CREATE INDEX "notifications_project_idx" ON "notifications" ("project_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_run_id_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id");