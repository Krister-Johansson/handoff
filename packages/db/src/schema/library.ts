import { integer, jsonb, pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./columns.ts";

export const mcpTransport = pgEnum("mcp_transport", ["stdio", "http"]);

/** A SKILL.md (plus supporting files) that nodes can enable by name. */
export const librarySkills = pgTable("library_skills", {
  id: id(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  body: text("body").notNull(),
  /** SKILL.md frontmatter keys other than name and description (license, allowed-tools, metadata). */
  frontmatter: jsonb("frontmatter").$type<Record<string, unknown>>().notNull().default({}),
  files: jsonb("files").$type<{ path: string; content: string }[]>().notNull().default([]),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * An MCP server nodes can enable by name. env and headers values may contain ${secret:NAME}; those
 * are resolved from the worker's environment when a node runs and are never stored here.
 */
export const libraryMcpServers = pgTable("library_mcp_servers", {
  id: id(),
  name: text("name").notNull().unique(),
  transport: mcpTransport("transport").notNull(),
  command: text("command"),
  args: jsonb("args").$type<string[]>().notNull().default([]),
  url: text("url"),
  env: jsonb("env").$type<Record<string, string>>().notNull().default({}),
  headers: jsonb("headers").$type<Record<string, string>>().notNull().default({}),
  /** Tool names to allow; empty means every tool of the server (mcp__<name>__*). */
  tools: jsonb("tools").$type<string[]>().notNull().default([]),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A Claude Code subagent definition, passed to the CLI with --agents. */
export const libraryAgents = pgTable("library_agents", {
  id: id(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  prompt: text("prompt").notNull(),
  tools: jsonb("tools").$type<string[]>().notNull().default([]),
  model: text("model"),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
