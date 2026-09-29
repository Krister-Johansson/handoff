CREATE TYPE "mcp_transport" AS ENUM('stdio', 'http');--> statement-breakpoint
CREATE TABLE "library_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL UNIQUE,
	"description" text NOT NULL,
	"prompt" text NOT NULL,
	"tools" jsonb DEFAULT '[]' NOT NULL,
	"model" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL UNIQUE,
	"transport" "mcp_transport" NOT NULL,
	"command" text,
	"args" jsonb DEFAULT '[]' NOT NULL,
	"url" text,
	"env" jsonb DEFAULT '{}' NOT NULL,
	"headers" jsonb DEFAULT '{}' NOT NULL,
	"tools" jsonb DEFAULT '[]' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL UNIQUE,
	"description" text NOT NULL,
	"body" text NOT NULL,
	"files" jsonb DEFAULT '[]' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
