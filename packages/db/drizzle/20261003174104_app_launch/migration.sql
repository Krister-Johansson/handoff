CREATE TYPE "launch_test_status" AS ENUM('starting', 'ready', 'failed', 'stopped');--> statement-breakpoint
CREATE TABLE "launch_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"status" "launch_test_status" DEFAULT 'starting'::"launch_test_status" NOT NULL,
	"command" text NOT NULL,
	"steps" jsonb DEFAULT '[]' NOT NULL,
	"worktree_path" text,
	"pid" integer,
	"port" integer,
	"url" text,
	"log_path" text,
	"error" text,
	"log" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"stops_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "launch" jsonb;--> statement-breakpoint
CREATE INDEX "launch_tests_project_idx" ON "launch_tests" ("project_id");--> statement-breakpoint
ALTER TABLE "launch_tests" ADD CONSTRAINT "launch_tests_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;