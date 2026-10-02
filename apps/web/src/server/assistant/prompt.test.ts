import { expect, test } from "vitest";
import { systemPromptFor } from "./prompt";

test("a voice turn asks for a short spoken answer and a typed turn does not", () => {
  const voice = systemPromptFor("voice");
  const typed = systemPromptFor("typed");
  expect(voice).toContain("read aloud");
  expect(voice).toMatch(/one or two short sentences/);
  expect(typed).not.toContain("read aloud");
  // Both keep handoff's rules.
  for (const prompt of [voice, typed]) expect(prompt).toContain("Never say an action happened unless the tool result says so.");
});
