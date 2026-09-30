import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { AgentDefinition } from "@handoff/cli-adapter";
import { renderSkillMarkdown, type LibrarySelection } from "@handoff/core";
import { getLibraryByNames, type DbExecutor, type McpServerRow } from "@handoff/db";

export class LibraryUnavailableError extends Error {}

export type MaterializedLibrary = {
  addDirs: string[];
  mcpConfigPath?: string;
  mcpServers: string[];
  allowedTools: string[];
  agents?: Record<string, AgentDefinition>;
  used: {
    groups: string[];
    skills: { name: string; version: number }[];
    mcp: { name: string; version: number }[];
    agents: { name: string; version: number }[];
  };
};

const SECRET_REF = /\$\{secret:([A-Z0-9_]+)\}/g;

function resolveSecrets(values: Record<string, string>, secrets: Record<string, string | undefined>, missing: Set<string>) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      value.replace(SECRET_REF, (_, name: string) => {
        const secret = secrets[name];
        if (secret === undefined || secret === "") missing.add(name);
        return secret ?? "";
      }),
    ]),
  );
}

function mcpEntry(server: McpServerRow, secrets: Record<string, string | undefined>, missing: Set<string>) {
  const env = resolveSecrets(server.env, secrets, missing);
  const headers = resolveSecrets(server.headers, secrets, missing);
  if (server.transport === "stdio") {
    return { type: "stdio", command: server.command ?? "", args: server.args, ...(Object.keys(env).length ? { env } : {}) };
  }
  return { type: "http", url: server.url ?? "", ...(Object.keys(headers).length ? { headers } : {}) };
}


/**
 * Writes the node's enabled library entries into its staging dir: skills under
 * <staging>/library/.claude/skills (passed with --add-dir), MCP servers into <staging>/mcp.json with
 * secrets resolved from the worker environment, and agents as --agents definitions.
 */
export async function materializeLibrary(
  db: DbExecutor,
  selection: LibrarySelection,
  stagingDir: string,
  secrets: Record<string, string | undefined>,
): Promise<MaterializedLibrary> {
  const found = await getLibraryByNames(db, selection);
  if (found.missing.length) throw new LibraryUnavailableError(`not in the library: ${found.missing.join(", ")}`);

  const result: MaterializedLibrary = {
    addDirs: [],
    mcpServers: [],
    allowedTools: [],
    used: {
      groups: selection.groups,
      skills: found.skills.map((s) => ({ name: s.name, version: s.version })),
      mcp: found.mcp.map((s) => ({ name: s.name, version: s.version })),
      agents: found.agents.map((s) => ({ name: s.name, version: s.version })),
    },
  };

  if (found.skills.length) {
    const root = join(stagingDir, "library");
    for (const skill of found.skills) {
      const dir = join(root, ".claude", "skills", skill.name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), renderSkillMarkdown(skill));
      for (const file of skill.files) {
        const target = normalize(join(dir, file.path));
        if (!target.startsWith(dir)) throw new LibraryUnavailableError(`skill ${skill.name} has a file outside its folder: ${file.path}`);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.content);
      }
    }
    result.addDirs.push(root);
  }

  if (found.mcp.length) {
    const missing = new Set<string>();
    const mcpServers = Object.fromEntries(found.mcp.map((server) => [server.name, mcpEntry(server, secrets, missing)]));
    if (missing.size) throw new LibraryUnavailableError(`missing secrets for MCP servers: ${[...missing].join(", ")}`);
    const path = join(stagingDir, "mcp.json");
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(path, JSON.stringify({ mcpServers }, null, 2), { mode: 0o600 });
    result.mcpConfigPath = path;
    result.mcpServers = found.mcp.map((s) => s.name);
    result.allowedTools = found.mcp.flatMap((s) => (s.tools.length ? s.tools.map((t) => `mcp__${s.name}__${t}`) : [`mcp__${s.name}__*`]));
  }

  if (found.agents.length) {
    result.agents = Object.fromEntries(
      found.agents.map((a) => [
        a.name,
        { description: a.description, prompt: a.prompt, ...(a.tools.length ? { tools: a.tools } : {}), ...(a.model ? { model: a.model } : {}) },
      ]),
    );
  }
  return result;
}
