CREATE TYPE "review_item_kind" AS ENUM('thread', 'review_body', 'summary_note', 'pre_merge_check');--> statement-breakpoint
CREATE TYPE "review_item_state" AS ENUM('open', 'answered', 'awaiting_review', 'resolved', 'disputed', 'reraised', 'left', 'gone');--> statement-breakpoint
CREATE TYPE "review_item_verdict" AS ENUM('fixed', 'declined', 'unclear', 'duplicate', 'settled');--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"run_id" uuid NOT NULL,
	"handle" integer NOT NULL,
	"key" text NOT NULL,
	"kind" "review_item_kind" NOT NULL,
	"github_id" text,
	"reviewer" text NOT NULL,
	"reviewer_bot" boolean DEFAULT false NOT NULL,
	"path" text,
	"line" integer,
	"body" text NOT NULL,
	"url" text,
	"round" integer NOT NULL,
	"verdict" "review_item_verdict",
	"evidence" text,
	"fix_commit" text,
	"duplicate_of" integer,
	"reply_comment_id" text,
	"reply_url" text,
	"reply_head_sha" text,
	"replied_at" timestamp with time zone,
	"state" "review_item_state" DEFAULT 'open'::"review_item_state" NOT NULL,
	"state_reason" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"question_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_items_run_handle_unique" UNIQUE("run_id","handle"),
	CONSTRAINT "review_items_run_key_unique" UNIQUE("run_id","key")
);
--> statement-breakpoint
CREATE INDEX "review_items_run_state_idx" ON "review_items" ("run_id","state");--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_run_id_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_question_id_questions_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id");