import { expect, test } from "vitest";
import { parseSkillMarkdown, renderSkillMarkdown } from "./skill-markdown.ts";

const raw = `---
name: tdd
description: "Test-driven development: red, green, refactor."
license: MIT
allowed-tools: Read, Edit
metadata:
  author: mattpocock
  tags: [testing, workflow]
---

# TDD

Write the test first.
`;

test("parseSkillMarkdown splits frontmatter into name, description and the other keys, and keeps the body", () => {
  expect(parseSkillMarkdown(raw)).toEqual({
    name: "tdd",
    description: "Test-driven development: red, green, refactor.",
    frontmatter: { license: "MIT", "allowed-tools": "Read, Edit", metadata: { author: "mattpocock", tags: ["testing", "workflow"] } },
    body: "# TDD\n\nWrite the test first.",
  });
});

test("a SKILL.md without frontmatter is all body", () => {
  expect(parseSkillMarkdown("# Just text\n")).toEqual({ frontmatter: {}, body: "# Just text" });
});

test("renderSkillMarkdown writes name and description first, then the other keys, and round-trips", () => {
  const skill = parseSkillMarkdown(raw);
  const out = renderSkillMarkdown({ name: skill.name!, description: skill.description!, frontmatter: skill.frontmatter, body: skill.body });
  expect(out.startsWith("---\nname: tdd\ndescription:")).toBe(true);
  expect(parseSkillMarkdown(out)).toEqual(skill);
});

test("a multi-line description is written on one line", () => {
  expect(renderSkillMarkdown({ name: "a", description: "one\ntwo", frontmatter: {}, body: "x" })).toContain("description: one two");
});
