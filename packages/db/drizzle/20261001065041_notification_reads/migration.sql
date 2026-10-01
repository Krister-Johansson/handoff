CREATE TABLE "notification_reads" (
	"id" integer PRIMARY KEY DEFAULT 1,
	"read_until" timestamp with time zone NOT NULL,
	CONSTRAINT "notification_reads_single_row" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE INDEX "events_type_created_idx" ON "events" ("type","created_at");