CREATE TABLE "screenshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"run_id" uuid NOT NULL,
	"node_execution_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"path" text NOT NULL,
	"caption" text NOT NULL,
	"criterion" text,
	"works" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "screenshots_run_idx" ON "screenshots" ("run_id");--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_run_id_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id");--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_node_execution_id_node_executions_id_fkey" FOREIGN KEY ("node_execution_id") REFERENCES "node_executions"("id");