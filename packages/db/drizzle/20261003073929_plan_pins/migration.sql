CREATE TABLE "plan_pins" (
	"project_id" uuid,
	"issue" integer,
	"pinned_by" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_pins_pkey" PRIMARY KEY("project_id","issue"),
	CONSTRAINT "plan_pins_reason_check" CHECK ("reason" in ('drop', 'keep_here', 'set_order'))
);
--> statement-breakpoint
ALTER TABLE "plan_pins" ADD CONSTRAINT "plan_pins_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;