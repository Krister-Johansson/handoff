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
  files: jsonb("files").$type<SkillFile[]>().notNull().default([]),
  /** Where an imported skill came from, with the content hash it was imported at; null for skills written here. */
  source: jsonb("source").$type<SkillSource>(),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A supporting file; binary files (fonts, images) are stored base64 and staged as bytes. */
export type SkillFile = { path: string; content: string; encoding?: "base64" };

/**
 * skills.sh: id is owner/repo/skill and hash is skills.sh's content hash. github: id is
 * owner/repo/path-to-folder and hash is the folder's git tree hash.
 */
export type SkillSource = { registry: "skills.sh" | "github"; id: string; hash: string };

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
  /** The latest connection check of this configuration; cleared when the server is saved again. */
  lastCheck: jsonb("last_check").$type<Record<string, unknown>>(),
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

/** A named set of library entries, like a skills repository or a plugin; a node enables it as one. */
export const libraryGroups = pgTable("library_groups", {
  id: id(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  skills: jsonb("skills").$type<string[]>().notNull().default([]),
  mcp: jsonb("mcp").$type<string[]>().notNull().default([]),
  agents: jsonb("agents").$type<string[]>().notNull().default([]),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
