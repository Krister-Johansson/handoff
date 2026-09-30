type SkillSource = { registry: "skills.sh" | "github"; id: string; hash: string };
type SkillListItem = { name: string; description: string; version: number; fileCount: number; source: SkillSource | null };

export type SkillSourceGroup<T extends SkillListItem> = {
  registry: "skills.sh" | "github" | "local";
  /** owner/repo, or null for skills written here. */
  repo: string | null;
  href: string | null;
  skills: T[];
};

const ORDER = { "skills.sh": 0, github: 1, local: 2 } as const;

/** Skills grouped by the repository they came from: skills.sh first, then GitHub, then those written here. */
export function groupSkillsBySource<T extends SkillListItem>(skills: T[]): SkillSourceGroup<T>[] {
  const groups = new Map<string, SkillSourceGroup<T>>();
  for (const skill of skills) {
    const registry = skill.source?.registry ?? "local";
    const repo = skill.source ? skill.source.id.split("/").slice(0, 2).join("/") : null;
    const key = `${registry}:${repo ?? ""}`;
    const href = repo ? (registry === "skills.sh" ? `https://skills.sh/${repo}` : `https://github.com/${repo}`) : null;
    const group = groups.get(key) ?? { registry, repo, href, skills: [] };
    group.skills.push(skill);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, skills: [...g.skills].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => ORDER[a.registry] - ORDER[b.registry] || (a.repo ?? "").localeCompare(b.repo ?? ""));
}
