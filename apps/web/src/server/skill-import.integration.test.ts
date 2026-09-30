import { afterAll, beforeEach, expect, test } from "vitest";
import { getLibraryByNames, upsertSkill } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { importSkill } from "./skill-import";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const skillMd = "---\nname: tdd\ndescription: Test first.\nlicense: MIT\n---\n\n# TDD\n";
const client = (hash: string, extra: { path: string; content: string }[] = []) => ({
  download: async () => ({ hash, files: [{ path: "SKILL.md", content: skillMd }, { path: "mocking.md", content: "# Mocks" }, { path: "metadata.json", content: "{}" }, ...extra] }),
});
const skill = async (name: string) => (await getLibraryByNames(db, { skills: [name], mcp: [], agents: [] })).skills[0];

test("importing a skill stores its instructions, frontmatter, files and where it came from", async () => {
  const result = await importSkill(db, client("h1"), "mattpocock/skills/tdd");
  expect(result).toEqual({ name: "tdd", version: 1, status: "imported" });
  expect(await skill("tdd")).toMatchObject({
    description: "Test first.",
    body: "# TDD",
    frontmatter: { license: "MIT" },
    files: [{ path: "mocking.md", content: "# Mocks" }],
    source: { registry: "skills.sh", id: "mattpocock/skills/tdd", hash: "h1" },
  });
});

test("importing again adds a version only when skills.sh has a different hash", async () => {
  await importSkill(db, client("h1"), "mattpocock/skills/tdd");
  expect(await importSkill(db, client("h1"), "mattpocock/skills/tdd")).toEqual({ name: "tdd", version: 1, status: "unchanged" });
  expect(await importSkill(db, client("h2", [{ path: "tests.md", content: "# Tests" }]), "mattpocock/skills/tdd")).toEqual({ name: "tdd", version: 2, status: "updated" });
  expect((await skill("tdd"))!.files.map((f) => f.path)).toEqual(["mocking.md", "tests.md"]);
});

test("a skill of the same name that was not imported from the same place is not overwritten", async () => {
  await upsertSkill(db, { name: "tdd", description: "Mine", body: "My own" });
  await expect(importSkill(db, client("h1"), "mattpocock/skills/tdd")).rejects.toThrow(/already has a skill named tdd/);
  expect((await skill("tdd"))!.description).toBe("Mine");
});

test("a download without a SKILL.md is refused", async () => {
  await expect(importSkill(db, { download: async () => ({ hash: "h", files: [{ path: "README.md", content: "x" }] }) }, "a/b/c")).rejects.toThrow(/SKILL.md/);
});
