CREATE TYPE "preview_status" AS ENUM('starting', 'running', 'stopped', 'failed');--> statement-breakpoint
CREATE TABLE "previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"run_id" uuid NOT NULL,
	"node_execution_id" uuid,
	"configuration" text NOT NULL,
	"worker_id" text NOT NULL,
	"status" "preview_status" DEFAULT 'starting'::"preview_status" NOT NULL,
	"pid" integer,
	"port" integer NOT NULL,
	"url" text NOT NULL,
	"log_path" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "previews_run_idx" ON "previews" ("run_id");--> statement-breakpoint
CREATE INDEX "previews_worker_status_idx" ON "previews" ("worker_id","status");--> statement-breakpoint
ALTER TABLE "previews" ADD CONSTRAINT "previews_run_id_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id");--> statement-breakpoint
ALTER TABLE "previews" ADD CONSTRAINT "previews_node_execution_id_node_executions_id_fkey" FOREIGN KEY ("node_execution_id") REFERENCES "node_executions"("id");