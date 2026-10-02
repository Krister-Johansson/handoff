import { expect, test } from "vitest";
import { SYSTEM_PROMPT, turnPrompt } from "./prompt";

test("a voice question carries the short spoken answer instruction in its own prompt, so it holds on every turn", () => {
  // Claude Code reuses the system prompt when it resumes a conversation, so a per-turn instruction cannot live there.
  expect(SYSTEM_PROMPT).toContain("Never say an action happened unless the tool result says so.");
  expect(SYSTEM_PROMPT).not.toContain("read aloud");
  const spoken = turnPrompt("what failed today", "voice");
  expect(spoken).toMatch(/read aloud/);
  expect(spoken).toMatch(/one or two short sentences/);
  expect(spoken.endsWith("what failed today")).toBe(true);
  expect(turnPrompt("what failed today", "typed")).toBe("what failed today");
});

test("a prompt that starts with a dash is not read as a CLI flag", () => {
  expect(turnPrompt("-v please", "typed")).toBe(" -v please");
});
