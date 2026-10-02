ALTER TABLE "runs" ADD COLUMN "size" text;--> statement-breakpoint
ALTER TABLE "node_executions" ADD COLUMN "queued_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_size_check" CHECK ("size" in ('S', 'M', 'L'));