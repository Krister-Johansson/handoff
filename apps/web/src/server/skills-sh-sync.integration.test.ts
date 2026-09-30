import { afterAll, beforeEach, expect, test } from "vitest";
import { listLibraryIndex, upsertSkill } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { syncSkillsShRepo } from "./skills-sh-sync";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const client = {
  download: async (id: string) => {
    const skillId = id.split("/").at(-1)!;
    if (skillId === "broken") throw new Error("skills.sh answered 500");
    return { hash: `h-${skillId}`, files: [{ path: "SKILL.md", content: `---\nname: ${skillId}\ndescription: ${skillId} skill\n---\n\nBody\n` }] };
  },
};

const library = async () => {
  const index = await listLibraryIndex(db);
  return { skills: index.skills.map((s) => s.name), groups: index.groups.map((g) => [g.name, g.skills]) };
};

test("ticked skills are added and kept together in a group named after the repository", async () => {
  const report = await syncSkillsShRepo(db, client, { repo: "mattpocock/skills", want: ["tdd", "grill-me"] });
  expect(report).toMatchObject({ added: ["grill-me", "tdd"], removed: [], failed: [], group: "mattpocock-skills" });
  expect(await library()).toEqual({ skills: ["grill-me", "tdd"], groups: [["mattpocock-skills", ["grill-me", "tdd"]]] });
});

test("unticked skills from that repository are removed, and the group follows", async () => {
  await syncSkillsShRepo(db, client, { repo: "mattpocock/skills", want: ["tdd", "grill-me"] });
  await upsertSkill(db, { name: "mine", description: "d", body: "b" });
  const report = await syncSkillsShRepo(db, client, { repo: "mattpocock/skills", want: ["grill-me"] });
  expect(report).toMatchObject({ added: [], removed: ["tdd"] });
  expect(await library()).toEqual({ skills: ["grill-me", "mine"], groups: [["mattpocock-skills", ["grill-me"]]] });
  await syncSkillsShRepo(db, client, { repo: "mattpocock/skills", want: [] });
  expect(await library()).toEqual({ skills: ["mine"], groups: [] });
});

test("a skill that cannot be added is reported and the rest still are", async () => {
  await upsertSkill(db, { name: "tdd", description: "My own", body: "b" });
  const report = await syncSkillsShRepo(db, client, { repo: "mattpocock/skills", want: ["tdd", "broken", "grill-me"] });
  expect(report.added).toEqual(["grill-me"]);
  expect(report.failed.map((f) => f.skillId)).toEqual(["broken", "tdd"]);
  expect(report.failed.find((f) => f.skillId === "tdd")?.reason).toMatch(/already has a skill named tdd/);
});
