CREATE TYPE "mcp_auth" AS ENUM('headers', 'oauth');--> statement-breakpoint
ALTER TABLE "library_mcp_servers" ADD COLUMN "auth" "mcp_auth" DEFAULT 'headers'::"mcp_auth" NOT NULL;