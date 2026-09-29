import { expect, test } from "vitest";
import { renderContextPacket } from "./render.ts";

const packet = {
  task: "Add a CHANGELOG.md",
  nodeKey: "coder",
  stateSlice: { plan: { steps: ["write file"] } },
  repoPaths: ["CHANGELOG.md"],
  constraints: { ownedPaths: ["CHANGELOG.md"], allowedTools: ["Read", "Edit"], maxTurns: 40 },
  outputContract: "coder_output",
};

test("renderContextPacket renders the fixed sections in order", () => {
  const md = renderContextPacket(packet);
  const headings = md.split("\n").filter((l) => l.startsWith("# "));
  expect(headings).toEqual(["# Task", "# Run state", "# Repository context", "# Constraints", "# Output contract"]);
  expect(md).toContain("Add a CHANGELOG.md");
  expect(md).toContain('"steps"');
  expect(md).toContain("coder_output");
});

test("renderContextPacket adds the previous attempt with failed check tails and unresolved review comments only", () => {
  const md = renderContextPacket({
    ...packet,
    priorAttempt: {
      summary: "tried once",
      failedChecks: [{ kind: "tests_green", passed: false, detail: "exit 1", logTail: Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n") }],
      reviewComments: [
        { author: "ann", path: "a.ts", line: 3, body: "rename this", resolved: false },
        { author: "bob", body: "old note", resolved: true },
      ],
    },
    humanAnswer: "Use ISO dates.",
    repairNote: "Retry with smaller diff.",
  });
  expect(md).toContain("# Previous attempt");
  expect(md).toContain("## Failed checks");
  expect(md).toContain("line 199");
  expect(md).not.toContain("line 100\n");
  expect(md).toContain("a.ts:3 - ann: rename this");
  expect(md).not.toContain("old note");
  expect(md).toContain("## Human answer");
  expect(md).toContain("## Operator note");
});
