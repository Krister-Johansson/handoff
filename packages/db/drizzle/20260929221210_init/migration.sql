CREATE TYPE "executor_kind" AS ENUM('cli', 'shell', 'github', 'human', 'function');--> statement-breakpoint
CREATE TYPE "node_execution_status" AS ENUM('pending', 'running', 'waiting', 'passed', 'failed', 'repaired');--> statement-breakpoint
CREATE TYPE "run_status" AS ENUM('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "wait_kind" AS ENUM('github_pr', 'human', 'timer');--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"installation_id" bigint NOT NULL UNIQUE,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL UNIQUE,
	"github_installation_id" uuid,
	"repo_id" bigint UNIQUE,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"local_clone_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"graph_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_versions_graph_version_unique" UNIQUE("graph_id","version")
);
--> statement-breakpoint
CREATE TABLE "graphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"latest_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graphs_project_name_unique" UNIQUE("project_id","name")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"graph_version_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'queued'::"run_status" NOT NULL,
	"task" text NOT NULL,
	"state" jsonb NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"next_event_seq" bigint DEFAULT 0 NOT NULL,
	"base_branch" text NOT NULL,
	"branch_name" text NOT NULL,
	"worktree_path" text,
	"pr_number" integer,
	"cancel_requested_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"run_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"node_type" text NOT NULL,
	"executor_kind" "executor_kind" NOT NULL,
	"attempt" integer NOT NULL,
	"status" "node_execution_status" DEFAULT 'pending'::"node_execution_status" NOT NULL,
	"runnable_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"reclaim_count" integer DEFAULT 0 NOT NULL,
	"interrupt_count" integer DEFAULT 0 NOT NULL,
	"wait_kind" "wait_kind",
	"wait_key" text,
	"wait_token" uuid UNIQUE,
	"wait_deadline_at" timestamp with time zone,
	"wake_requested_at" timestamp with time zone,
	"wake_reason" text,
	"wake_payload" jsonb,
	"context_packet" jsonb,
	"output" jsonb,
	"checks" jsonb,
	"error" jsonb,
	"executor_session_id" text,
	"cost_usd" numeric(12,6),
	"usage" jsonb,
	"repaired_from_execution_id" uuid,
	"repair_note" text,
	"claimed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "node_executions_run_node_attempt_unique" UNIQUE("run_id","node_key","attempt")
);
--> statement-breakpoint
CREATE TABLE "edge_traversals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"run_id" uuid NOT NULL,
	"edge_key" text NOT NULL,
	"from_execution_id" uuid NOT NULL,
	"to_node_key" text NOT NULL,
	"consumed_by_execution_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"node_execution_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_run_seq_unique" UNIQUE("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"delivery_id" text NOT NULL UNIQUE,
	"event_name" text NOT NULL,
	"action" text,
	"installation_id" bigint,
	"repo_id" bigint,
	"correlation_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"woke_execution_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" text PRIMARY KEY,
	"hostname" text NOT NULL,
	"caps" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "graph_versions_graph_idx" ON "graph_versions" ("graph_id");--> statement-breakpoint
CREATE INDEX "runs_project_created_idx" ON "runs" ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" ("status");--> statement-breakpoint
CREATE INDEX "node_executions_claim_idx" ON "node_executions" ("executor_kind","runnable_at","created_at") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "node_executions_lease_idx" ON "node_executions" ("lease_expires_at") WHERE "status" = 'running';--> statement-breakpoint
CREATE INDEX "node_executions_wait_deadline_idx" ON "node_executions" ("wait_deadline_at") WHERE "status" = 'waiting';--> statement-breakpoint
CREATE INDEX "node_executions_wait_key_idx" ON "node_executions" ("wait_key") WHERE "status" in ('running', 'waiting');--> statement-breakpoint
CREATE INDEX "node_executions_run_idx" ON "node_executions" ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "edge_traversals_unconsumed_idx" ON "edge_traversals" ("run_id","to_node_key") WHERE "consumed_by_execution_id" is null;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_repo_received_idx" ON "webhook_deliveries" ("repo_id","received_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_github_installation_id_github_installations_id_fkey" FOREIGN KEY ("github_installation_id") REFERENCES "github_installations"("id");--> statement-breakpoint
ALTER TABLE "graph_versions" ADD CONSTRAINT "graph_versions_graph_id_graphs_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "graphs"("id");--> statement-breakpoint
ALTER TABLE "graphs" ADD CONSTRAINT "graphs_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_graph_version_id_graph_versions_id_fkey" FOREIGN KEY ("graph_version_id") REFERENCES "graph_versions"("id");--> statement-breakpoint
ALTER TABLE "node_executions" ADD CONSTRAINT "node_executions_run_id_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id");--> statement-breakpoint
ALTER TABLE "node_executions" ADD CONSTRAINT "node_executions_SXty6ZfBwrNc_fkey" FOREIGN KEY ("repaired_from_execution_id") REFERENCES "node_executions"("id");--> statement-breakpoint
ALTER TABLE "edge_traversals" ADD CONSTRAINT "edge_traversals_run_id_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id");--> statement-breakpoint
ALTER TABLE "edge_traversals" ADD CONSTRAINT "edge_traversals_from_execution_id_node_executions_id_fkey" FOREIGN KEY ("from_execution_id") REFERENCES "node_executions"("id");--> statement-breakpoint
ALTER TABLE "edge_traversals" ADD CONSTRAINT "edge_traversals_iARfW5W1IRqm_fkey" FOREIGN KEY ("consumed_by_execution_id") REFERENCES "node_executions"("id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_run_id_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_node_execution_id_node_executions_id_fkey" FOREIGN KEY ("node_execution_id") REFERENCES "node_executions"("id");