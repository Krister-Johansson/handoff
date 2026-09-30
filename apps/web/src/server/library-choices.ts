import { listLibraryIndex, type DbExecutor } from "@handoff/db";
import type { LibraryChoices } from "../lib/library-choices";
import { groupSkillsBySource } from "../lib/skill-sources";

/** The whole library as choices: skills grouped by where they came from, the other kinds with a line each. */
export async function libraryChoices(db: DbExecutor): Promise<LibraryChoices> {
  const { skills, mcp, agents, groups } = await listLibraryIndex(db);
  return {
    skills: groupSkillsBySource(skills).flatMap((g) => g.skills.map((s) => ({ name: s.name, detail: s.description, source: g.repo ?? "Written here" }))),
    mcp: mcp.map((m) => ({ name: m.name, detail: m.url ?? `${m.command ?? ""} ${m.args.join(" ")}`.trim() })),
    agents: agents.map((a) => ({ name: a.name, detail: a.description })),
    groups: groups.map((g) => ({ name: g.name, detail: g.description || [...g.skills, ...g.mcp, ...g.agents].join(", ") })),
  };
}
