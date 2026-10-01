CREATE TYPE "permission_status" AS ENUM('pending', 'allowed', 'denied', 'expired');--> statement-breakpoint
CREATE TABLE "permission_requests" (
	"id" uuid PRIMARY KEY,
	"run_id" uuid NOT NULL,
	"node_execution_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"input" jsonb NOT NULL,
	"status" "permission_status" DEFAULT 'pending'::"permission_status" NOT NULL,
	"rule" text,
	"message" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "permission_requests_execution_idx" ON "permission_requests" ("node_execution_id","status");--> statement-breakpoint
CREATE INDEX "permission_requests_run_idx" ON "permission_requests" ("run_id");--> statement-breakpoint
ALTER TABLE "permission_requests" ADD CONSTRAINT "permission_requests_run_id_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id");--> statement-breakpoint
ALTER TABLE "permission_requests" ADD CONSTRAINT "permission_requests_node_execution_id_node_executions_id_fkey" FOREIGN KEY ("node_execution_id") REFERENCES "node_executions"("id");