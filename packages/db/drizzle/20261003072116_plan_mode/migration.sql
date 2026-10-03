ALTER TABLE "projects" ADD COLUMN "plan_mode" text DEFAULT 'flow' NOT NULL;--> statement-breakpoint
-- Projects that existed before plan modes keep planning with dates; projects added from now on start in Flow.
UPDATE "projects" SET "plan_mode" = 'timeline';--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_plan_mode_check" CHECK ("plan_mode" in ('flow', 'timeline'));
