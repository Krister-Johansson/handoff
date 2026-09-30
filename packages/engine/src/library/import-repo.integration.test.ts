import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { getLibraryByNames, listLibrary, upsertSkill } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { importSkillRepository } from "./import-repo.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@e", ...args], { cwd, encoding: "utf8" }).trim();
const FONT = Buffer.from([0, 1, 0, 0, 0, 0x12, 0xff, 0xfe, 0x00, 0x42]);

/** A repository shaped like anthropics/skills: skills/<name>/SKILL.md plus a template/ skill at another depth. */
function skillsRepo() {
  const work = mkdtempSync(join(tmpdir(), "handoff-skills-repo-"));
  const put = (path: string, content: string | Buffer) => {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), content);
  };
  put("README.md", "# Skills\n");
  put("skills/pdf/SKILL.md", "---\nname: pdf\ndescription: Work with PDF files.\nlicense: Proprietary\n---\n\n# PDF\n");
  put("skills/pdf/scripts/fill.py", "print('fill')\n");
  put("skills/canvas-design/SKILL.md", "---\nname: canvas-design\ndescription: Make posters.\n---\n\nUse the fonts.\n");
  put("skills/canvas-design/fonts/Inter.ttf", FONT);
  put("template/SKILL.md", "---\nname: template-skill\ndescription: A template.\n---\n\nBody\n");
  git(work, "init", "-q", "-b", "main");
  git(work, "add", "-A");
  git(work, "commit", "-qm", "skills");
  return work;
}

const skill = async (name: string) => (await getLibraryByNames(db, { skills: [name], mcp: [], agents: [] })).skills[0];

test("importing a repository imports every SKILL.md folder with its files and groups them", async () => {
  const repo = skillsRepo();
  const report = await importSkillRepository(db, { repo: "anthropics/skills", url: repo, group: "anthropic" });
  expect(report.skills.map((s) => [s.name, s.status]).sort()).toEqual([
    ["canvas-design", "imported"],
    ["pdf", "imported"],
    ["template-skill", "imported"],
  ]);
  expect(await skill("pdf")).toMatchObject({
    description: "Work with PDF files.",
    frontmatter: { license: "Proprietary" },
    files: [{ path: "scripts/fill.py", content: "print('fill')\n" }],
    source: { registry: "github", id: "anthropics/skills/skills/pdf", hash: git(repo, "rev-parse", "HEAD:skills/pdf") },
  });
  expect((await skill("canvas-design"))!.files).toEqual([{ path: "fonts/Inter.ttf", content: FONT.toString("base64"), encoding: "base64" }]);
  const [group] = (await listLibrary(db)).groups;
  expect(group).toMatchObject({ name: "anthropic", skills: ["canvas-design", "pdf", "template-skill"], mcp: [], agents: [] });
  expect(group!.description).toContain("github.com/anthropics/skills");
});

test("importing again versions only the skills that changed", async () => {
  const repo = skillsRepo();
  await importSkillRepository(db, { repo: "anthropics/skills", url: repo, group: "anthropic" });
  writeFileSync(join(repo, "skills/pdf/SKILL.md"), "---\nname: pdf\ndescription: Work with PDF files, better.\n---\n\n# PDF\n");
  git(repo, "commit", "-qam", "pdf");
  const report = await importSkillRepository(db, { repo: "anthropics/skills", url: repo, group: "anthropic" });
  expect(Object.fromEntries(report.skills.map((s) => [s.name, [s.status, "version" in s ? s.version : null]]))).toEqual({
    pdf: ["updated", 2],
    "canvas-design": ["unchanged", 1],
    "template-skill": ["unchanged", 1],
  });
});

test("a library skill of the same name from somewhere else is skipped, not overwritten, and left out of the group", async () => {
  await upsertSkill(db, { name: "pdf", description: "Mine", body: "My own" });
  const report = await importSkillRepository(db, { repo: "anthropics/skills", url: skillsRepo(), group: "anthropic" });
  expect(report.skills.find((s) => s.name === "pdf")).toMatchObject({ status: "skipped", reason: expect.stringContaining("already") });
  expect((await skill("pdf"))!.description).toBe("Mine");
  expect((await listLibrary(db)).groups[0]!.skills).toEqual(["canvas-design", "template-skill"]);
});

test("a repository without skills is reported and makes no group", async () => {
  const empty = mkdtempSync(join(tmpdir(), "handoff-empty-repo-"));
  writeFileSync(join(empty, "README.md"), "x");
  git(empty, "init", "-q", "-b", "main");
  git(empty, "add", "-A");
  git(empty, "commit", "-qm", "x");
  await expect(importSkillRepository(db, { repo: "o/empty", url: empty, group: "g" })).rejects.toThrow(/no SKILL.md/);
  expect((await listLibrary(db)).groups).toEqual([]);
});
