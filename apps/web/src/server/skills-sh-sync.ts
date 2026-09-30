import { suggestProjectName } from "@handoff/core";
import { deleteLibraryEntry, listLibraryIndex, upsertGroup, type Db } from "@handoff/db";
import { importSkill } from "./skill-import";
import type { SkillsShDownload } from "./skills-sh";

export type SyncReport = { repo: string; group: string; added: string[]; removed: string[]; failed: { skillId: string; reason: string }[] };

/** The library group that holds a skills.sh repository's skills, named after it (mattpocock/skills → mattpocock-skills). */
export const repoGroupName = (repo: string) => suggestProjectName(repo.replace("/", "-"), []);

/**
 * Makes the library hold exactly the ticked skills of a skills.sh repository: ticked ones not yet in
 * the library are imported, library skills from that repository that are not ticked are removed, and
 * a group named after the repository lists what is left (and is removed when nothing is).
 */
export async function syncSkillsShRepo(
  db: Db,
  client: { download(id: string): Promise<SkillsShDownload> },
  input: { repo: string; want: string[] },
): Promise<SyncReport> {
  const group = repoGroupName(input.repo);
  const fromRepo = (id: string | undefined) => id?.startsWith(`${input.repo}/`) === true;
  const before = (await listLibraryIndex(db)).skills.filter((s) => s.source?.registry === "skills.sh" && fromRepo(s.source.id));
  const installed = new Map(before.map((s) => [s.source!.id.slice(input.repo.length + 1), s.name]));
  const want = new Set(input.want);

  const report: SyncReport = { repo: input.repo, group, added: [], removed: [], failed: [] };
  const toAdd = [...want].filter((id) => !installed.has(id)).sort();
  const added = await Promise.allSettled(toAdd.map((skillId) => importSkill(db, client, `${input.repo}/${skillId}`)));
  added.forEach((result, i) => {
    if (result.status === "fulfilled") report.added.push(result.value.name);
    else report.failed.push({ skillId: toAdd[i]!, reason: (result.reason as Error).message });
  });
  const toRemove = [...installed].filter(([id]) => !want.has(id)).map(([, name]) => name).sort();
  await Promise.all(toRemove.map((name) => deleteLibraryEntry(db, "skill", name)));
  report.removed.push(...toRemove);
  report.added.sort();

  const now = (await listLibraryIndex(db)).skills.filter((s) => s.source?.registry === "skills.sh" && fromRepo(s.source.id)).map((s) => s.name);
  if (now.length) await upsertGroup(db, { name: group, description: `Skills from skills.sh/${input.repo}`, skills: now.sort(), mcp: [], agents: [] });
  else await deleteLibraryEntry(db, "group", group);
  return report;
}
