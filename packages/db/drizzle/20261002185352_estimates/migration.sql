ALTER TABLE "projects" ADD COLUMN "plan_hours_per_day" numeric(4,1) DEFAULT '6' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "size" text;--> statement-breakpoint
ALTER TABLE "node_executions" ADD COLUMN "queued_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_plan_hours_per_day_check" CHECK ("plan_hours_per_day" between 1 and 24);--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_size_check" CHECK ("size" in ('S', 'M', 'L'));