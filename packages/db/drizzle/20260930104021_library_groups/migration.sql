CREATE TABLE "library_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL UNIQUE,
	"description" text DEFAULT '' NOT NULL,
	"skills" jsonb DEFAULT '[]' NOT NULL,
	"mcp" jsonb DEFAULT '[]' NOT NULL,
	"agents" jsonb DEFAULT '[]' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
