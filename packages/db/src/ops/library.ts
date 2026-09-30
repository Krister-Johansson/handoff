import { asc, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "../client.ts";
import { libraryAgents, libraryGroups, libraryMcpServers, librarySkills, type SkillFile, type SkillSource } from "../schema/index.ts";

export type SkillRow = typeof librarySkills.$inferSelect;
export type McpServerRow = typeof libraryMcpServers.$inferSelect;
export type AgentRow = typeof libraryAgents.$inferSelect;
export type GroupRow = typeof libraryGroups.$inferSelect;
export type GroupInput = { name: string; description: string; skills: string[]; mcp: string[]; agents: string[] };

export type SkillInput = {
  name: string;
  description: string;
  body: string;
  frontmatter?: Record<string, unknown>;
  files?: SkillFile[];
  /** Set by an import; left out, an existing skill keeps its source. */
  source?: SkillSource;
};
export type McpServerInput = {
  name: string;
  transport: "stdio" | "http";
  command?: string | null;
  args?: string[];
  url?: string | null;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  tools?: string[];
};
export type AgentInput = { name: string; description: string; prompt: string; tools?: string[]; model?: string | null };

export async function upsertSkill(db: DbExecutor, input: SkillInput): Promise<SkillRow> {
  const values = {
    name: input.name,
    description: input.description,
    body: input.body,
    frontmatter: input.frontmatter ?? {},
    files: input.files ?? [],
    ...(input.source ? { source: input.source } : {}),
  };
  const [row] = await db
    .insert(librarySkills)
    .values(values)
    .onConflictDoUpdate({ target: librarySkills.name, set: { ...values, version: sql`${librarySkills.version} + 1` } })
    .returning();
  return row!;
}

export async function upsertMcpServer(db: DbExecutor, input: McpServerInput): Promise<McpServerRow> {
  const values = {
    name: input.name,
    transport: input.transport,
    command: input.command ?? null,
    args: input.args ?? [],
    url: input.url ?? null,
    env: input.env ?? {},
    headers: input.headers ?? {},
    tools: input.tools ?? [],
  };
  const [row] = await db
    .insert(libraryMcpServers)
    .values(values)
    .onConflictDoUpdate({ target: libraryMcpServers.name, set: { ...values, version: sql`${libraryMcpServers.version} + 1` } })
    .returning();
  return row!;
}

export async function upsertAgent(db: DbExecutor, input: AgentInput): Promise<AgentRow> {
  const values = { name: input.name, description: input.description, prompt: input.prompt, tools: input.tools ?? [], model: input.model ?? null };
  const [row] = await db
    .insert(libraryAgents)
    .values(values)
    .onConflictDoUpdate({ target: libraryAgents.name, set: { ...values, version: sql`${libraryAgents.version} + 1` } })
    .returning();
  return row!;
}

export async function upsertGroup(db: DbExecutor, input: GroupInput): Promise<GroupRow> {
  const values = { name: input.name, description: input.description, skills: input.skills, mcp: input.mcp, agents: input.agents };
  const [row] = await db
    .insert(libraryGroups)
    .values(values)
    .onConflictDoUpdate({ target: libraryGroups.name, set: { ...values, version: sql`${libraryGroups.version} + 1` } })
    .returning();
  return row!;
}

export async function listLibrary(db: DbExecutor) {
  const [skills, mcp, agents, groups] = await Promise.all([
    db.select().from(librarySkills).orderBy(asc(librarySkills.name)),
    db.select().from(libraryMcpServers).orderBy(asc(libraryMcpServers.name)),
    db.select().from(libraryAgents).orderBy(asc(libraryAgents.name)),
    db.select().from(libraryGroups).orderBy(asc(libraryGroups.name)),
  ]);
  return { skills, mcp, agents, groups };
}

/**
 * Every library entry for lists and pickers: skills without their body or file contents, which can
 * run to megabytes for imported skills with fonts or schemas.
 */
export async function listLibraryIndex(db: DbExecutor) {
  const [skills, mcp, agents, groups] = await Promise.all([
    db
      .select({
        name: librarySkills.name,
        description: librarySkills.description,
        version: librarySkills.version,
        fileCount: sql<number>`jsonb_array_length(${librarySkills.files})`.mapWith(Number),
        source: librarySkills.source,
      })
      .from(librarySkills)
      .orderBy(asc(librarySkills.name)),
    db.select().from(libraryMcpServers).orderBy(asc(libraryMcpServers.name)),
    db.select().from(libraryAgents).orderBy(asc(libraryAgents.name)),
    db.select().from(libraryGroups).orderBy(asc(libraryGroups.name)),
  ]);
  return { skills, mcp, agents, groups };
}

/**
 * Library entries by name. Groups named in `groups` are expanded into their entries and merged with
 * the names given directly; missing groups and entries are reported, groups first.
 */
export async function getLibraryByNames(db: DbExecutor, selection: { skills: string[]; mcp: string[]; agents: string[]; groups?: string[] }) {
  const groupNames = selection.groups ?? [];
  const groups = groupNames.length ? await db.select().from(libraryGroups).where(inArray(libraryGroups.name, groupNames)) : [];
  const missingGroups = groupNames.filter((n) => !groups.some((g) => g.name === n)).map((n) => `group ${n}`);
  const union = (direct: string[], key: "skills" | "mcp" | "agents") => [...new Set([...direct, ...groups.flatMap((g) => g[key])])];
  const names = { skills: union(selection.skills, "skills"), mcp: union(selection.mcp, "mcp"), agents: union(selection.agents, "agents") };
  const [skills, mcp, agents] = await Promise.all([
    names.skills.length ? db.select().from(librarySkills).where(inArray(librarySkills.name, names.skills)) : Promise.resolve([] as SkillRow[]),
    names.mcp.length ? db.select().from(libraryMcpServers).where(inArray(libraryMcpServers.name, names.mcp)) : Promise.resolve([] as McpServerRow[]),
    names.agents.length ? db.select().from(libraryAgents).where(inArray(libraryAgents.name, names.agents)) : Promise.resolve([] as AgentRow[]),
  ]);
  const missing = [
    ...missingGroups,
    ...names.skills.filter((n) => !skills.some((s) => s.name === n)).map((n) => `skill ${n}`),
    ...names.mcp.filter((n) => !mcp.some((s) => s.name === n)).map((n) => `mcp server ${n}`),
    ...names.agents.filter((n) => !agents.some((s) => s.name === n)).map((n) => `agent ${n}`),
  ];
  return { skills, mcp, agents, missing };
}

export async function deleteLibraryEntry(db: DbExecutor, kind: "skill" | "mcp" | "agent" | "group", name: string) {
  if (kind === "group") await db.delete(libraryGroups).where(eq(libraryGroups.name, name));
  if (kind === "skill") await db.delete(librarySkills).where(eq(librarySkills.name, name));
  else if (kind === "mcp") await db.delete(libraryMcpServers).where(eq(libraryMcpServers.name, name));
  else await db.delete(libraryAgents).where(eq(libraryAgents.name, name));
}
