import { asc, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "../client.ts";
import { libraryAgents, libraryMcpServers, librarySkills, type SkillSource } from "../schema/index.ts";

export type SkillRow = typeof librarySkills.$inferSelect;
export type McpServerRow = typeof libraryMcpServers.$inferSelect;
export type AgentRow = typeof libraryAgents.$inferSelect;

export type SkillInput = {
  name: string;
  description: string;
  body: string;
  frontmatter?: Record<string, unknown>;
  files?: { path: string; content: string }[];
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

export async function listLibrary(db: DbExecutor) {
  const [skills, mcp, agents] = await Promise.all([
    db.select().from(librarySkills).orderBy(asc(librarySkills.name)),
    db.select().from(libraryMcpServers).orderBy(asc(libraryMcpServers.name)),
    db.select().from(libraryAgents).orderBy(asc(libraryAgents.name)),
  ]);
  return { skills, mcp, agents };
}

export async function getLibraryByNames(db: DbExecutor, names: { skills: string[]; mcp: string[]; agents: string[] }) {
  const [skills, mcp, agents] = await Promise.all([
    names.skills.length ? db.select().from(librarySkills).where(inArray(librarySkills.name, names.skills)) : Promise.resolve([] as SkillRow[]),
    names.mcp.length ? db.select().from(libraryMcpServers).where(inArray(libraryMcpServers.name, names.mcp)) : Promise.resolve([] as McpServerRow[]),
    names.agents.length ? db.select().from(libraryAgents).where(inArray(libraryAgents.name, names.agents)) : Promise.resolve([] as AgentRow[]),
  ]);
  const missing = [
    ...names.skills.filter((n) => !skills.some((s) => s.name === n)).map((n) => `skill ${n}`),
    ...names.mcp.filter((n) => !mcp.some((s) => s.name === n)).map((n) => `mcp server ${n}`),
    ...names.agents.filter((n) => !agents.some((s) => s.name === n)).map((n) => `agent ${n}`),
  ];
  return { skills, mcp, agents, missing };
}

export async function deleteLibraryEntry(db: DbExecutor, kind: "skill" | "mcp" | "agent", name: string) {
  if (kind === "skill") await db.delete(librarySkills).where(eq(librarySkills.name, name));
  else if (kind === "mcp") await db.delete(libraryMcpServers).where(eq(libraryMcpServers.name, name));
  else await db.delete(libraryAgents).where(eq(libraryAgents.name, name));
}
