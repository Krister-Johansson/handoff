import { expect, test } from "vitest";
import { groupSkillsBySource } from "./skill-sources";

const skill = (name: string, source: { registry: "skills.sh" | "github"; id: string; hash: string } | null) => ({ name, description: "", version: 1, fileCount: 0, source });

test("skills are grouped by repository: skills.sh first, then GitHub, then the ones written here", () => {
  const groups = groupSkillsBySource([
    skill("ci-triage", null),
    skill("pdf", { registry: "github", id: "anthropics/skills/skills/pdf", hash: "h" }),
    skill("tdd", { registry: "skills.sh", id: "mattpocock/skills/tdd", hash: "h" }),
    skill("grill-me", { registry: "skills.sh", id: "mattpocock/skills/grill-me", hash: "h" }),
    skill("xlsx", { registry: "github", id: "anthropics/skills/skills/xlsx", hash: "h" }),
    skill("root", { registry: "github", id: "someone/one-skill", hash: "h" }),
  ]);
  expect(groups.map((g) => [g.registry, g.repo, g.skills.map((s) => s.name)])).toEqual([
    ["skills.sh", "mattpocock/skills", ["grill-me", "tdd"]],
    ["github", "anthropics/skills", ["pdf", "xlsx"]],
    ["github", "someone/one-skill", ["root"]],
    ["local", null, ["ci-triage"]],
  ]);
  expect(groups[0]!.href).toBe("https://skills.sh/mattpocock/skills");
  expect(groups[1]!.href).toBe("https://github.com/anthropics/skills");
});
