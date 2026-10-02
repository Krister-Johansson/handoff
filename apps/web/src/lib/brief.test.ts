import { expect, test } from "vitest";
import { brief, questionBrief } from "./brief";

const LONG =
  "Four palette colours fall below 3:1 on the --accent that a hovered board or dashboard card paints in the dark theme. Measured contrast against dark --accent: Blue 2.88, Green 2.97, Amber 2.97, Teal 2.72. How should the hovered-card case be handled?";

test("a short text stays whole, on one line", () => {
  expect(brief("Which license?")).toBe("Which license?");
  expect(brief("  Add a\n  CHANGELOG.md ")).toBe("Add a CHANGELOG.md");
});

test("a long text is cut at a word, with an ellipsis, to at most 140 characters", () => {
  const cut = brief(LONG);
  expect(cut.length).toBeLessThanOrEqual(140);
  expect(cut).toBe("Four palette colours fall below 3:1 on the --accent that a hovered board or dashboard card paints in the dark theme. Measured contrast…");
});

test("a question is told by the summary its asker wrote, and by its own text when there is none", () => {
  expect(questionBrief(LONG, { reason: "needs_input", summary: "How should hovered cards handle the four low-contrast colours?" })).toBe("How should hovered cards handle the four low-contrast colours?");
  expect(questionBrief("Which license?", { reason: "needs_input" })).toBe("Which license?");
  expect(questionBrief(LONG, { summary: "  " })).toBe(brief(LONG));
  expect(questionBrief(LONG, null)).toBe(brief(LONG));
});
