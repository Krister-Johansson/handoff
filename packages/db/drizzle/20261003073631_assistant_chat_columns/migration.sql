ALTER TABLE "assistant_conversations" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;