import { expect, test } from "vitest";
import { skillsShPath } from "./skills-sh-path";

test("an owner, a repository or a skills.sh link opens that page in the library", () => {
  expect(skillsShPath("mattpocock")).toBe("/library/skills-sh/mattpocock");
  expect(skillsShPath("mattpocock/skills")).toBe("/library/skills-sh/mattpocock/skills");
  expect(skillsShPath("https://www.skills.sh/mattpocock")).toBe("/library/skills-sh/mattpocock");
  expect(skillsShPath("https://skills.sh/vercel-labs/agent-skills/")).toBe("/library/skills-sh/vercel-labs/agent-skills");
  expect(skillsShPath("a/b/c")).toBeNull();
  expect(skillsShPath("../x")).toBeNull();
  expect(skillsShPath("")).toBeNull();
});
