ALTER TYPE "wait_kind" ADD VALUE 'merge_queue';--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "merge_queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "merge_requested_at" timestamp with time zone;