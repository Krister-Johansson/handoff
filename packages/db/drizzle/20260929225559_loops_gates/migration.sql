CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"run_id" uuid NOT NULL,
	"node_execution_id" uuid NOT NULL UNIQUE,
	"question" text NOT NULL,
	"options" jsonb DEFAULT '[]' NOT NULL,
	"context" jsonb DEFAULT '{}' NOT NULL,
	"answer" text,
	"option" text,
	"answered_by" text,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "node_executions" ADD COLUMN "trigger" jsonb;--> statement-breakpoint
CREATE INDEX "questions_run_idx" ON "questions" ("run_id");--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_run_id_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id");--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_node_execution_id_node_executions_id_fkey" FOREIGN KEY ("node_execution_id") REFERENCES "node_executions"("id");