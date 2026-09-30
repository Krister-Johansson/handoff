import { parseSkillMarkdown } from "@handoff/core";
import { getLibraryByNames, upsertSkill, type Db } from "@handoff/db";
import type { SkillsShDownload } from "./skills-sh";

const MAX_FILE_BYTES = 512 * 1024;
/** skills.sh bookkeeping, not part of the skill. */
const SKIPPED = new Set(["metadata.json"]);

export type ImportResult = { name: string; version: number; status: "imported" | "updated" | "unchanged" };

/**
 * Imports a skill from skills.sh into the library, or updates it when skills.sh has a new hash. A
 * library skill of the same name that did not come from the same skills.sh id is never overwritten.
 */
export async function importSkill(db: Db, client: { download(id: string): Promise<SkillsShDownload> }, id: string): Promise<ImportResult> {
  const { files, hash } = await client.download(id);
  const skillMd = files.find((f) => f.path === "SKILL.md");
  if (!skillMd) throw new Error(`${id} has no SKILL.md`);
  const parsed = parseSkillMarkdown(skillMd.content);
  const name = (parsed.name ?? id.split("/").at(-1)!).toLowerCase();
  const [existing] = (await getLibraryByNames(db, { skills: [name], mcp: [], agents: [] })).skills;
  if (existing && existing.source?.id !== id) throw new Error(`The library already has a skill named ${name} that did not come from ${id}.`);
  if (existing && existing.source?.hash === hash) return { name, version: existing.version, status: "unchanged" };
  const row = await upsertSkill(db, {
    name,
    description: parsed.description ?? "",
    body: parsed.body,
    frontmatter: parsed.frontmatter,
    files: files.filter((f) => f.path !== "SKILL.md" && !SKIPPED.has(f.path) && Buffer.byteLength(f.content) <= MAX_FILE_BYTES),
    source: { registry: "skills.sh", id, hash },
  });
  return { name, version: row.version, status: existing ? "updated" : "imported" };
}
