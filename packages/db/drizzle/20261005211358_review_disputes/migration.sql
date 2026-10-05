ALTER TABLE "questions" ADD COLUMN "choices" jsonb;--> statement-breakpoint
ALTER TABLE "review_items" ADD COLUMN "returns" integer DEFAULT 0 NOT NULL;