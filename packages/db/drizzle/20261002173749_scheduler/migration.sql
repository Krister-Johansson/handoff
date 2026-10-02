CREATE TABLE "project_schedulers" (
	"project_id" uuid PRIMARY KEY,
	"enabled" boolean DEFAULT false NOT NULL,
	"max_runs" integer DEFAULT 1 NOT NULL,
	"order" text DEFAULT 'project' NOT NULL,
	"graph_name" text NOT NULL,
	"skip_label" text DEFAULT 'human',
	"paused_at" timestamp with time zone,
	"paused_by" text,
	"pause_reason" text,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_check_at" timestamp with time zone,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"start_failures" integer DEFAULT 0 NOT NULL,
	"last_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_schedulers_max_runs_check" CHECK ("max_runs" between 1 and 10),
	CONSTRAINT "project_schedulers_order_check" CHECK ("order" in ('project', 'priority'))
);
--> statement-breakpoint
CREATE TABLE "scheduler_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scheduler_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"project_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "project_schedulers_due_idx" ON "project_schedulers" ("next_check_at") WHERE "enabled" and "paused_at" is null;--> statement-breakpoint
CREATE INDEX "scheduler_events_project_created_idx" ON "scheduler_events" ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "project_schedulers" ADD CONSTRAINT "project_schedulers_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scheduler_events" ADD CONSTRAINT "scheduler_events_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;