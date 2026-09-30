import { expect, test } from "vitest";
import type { DiffFile } from "@handoff/core";
import { highlightFiles, languageOf } from "./highlight";

const file: DiffFile = {
  path: "src/a.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  whole: true,
  hunks: [
    {
      oldStart: 1,
      newStart: 1,
      lines: [
        { kind: "context", oldLine: 1, newLine: 1, text: "const a = 1;" },
        { kind: "del", oldLine: 2, text: "let b = 2;" },
        { kind: "add", newLine: 2, text: "const b = 2;" },
      ],
    },
  ],
};

test("a file's language comes from its extension or name, and plain text otherwise", () => {
  expect(languageOf("src/a.ts")).toBe("typescript");
  expect(languageOf("docs/x.md")).toBe("markdown");
  expect(languageOf("pnpm-workspace.yaml")).toBe("yaml");
  expect(languageOf("Dockerfile")).toBe("docker");
  expect(languageOf(".gitignore")).toBe("text");
});

test("both versions of each line are coloured, with light and dark colours per token", async () => {
  const tokens = await highlightFiles([file, { ...file, path: "pnpm-lock.yaml", collapsed: "generated", hunks: [] }]);
  expect(Object.keys(tokens)).toEqual(["src/a.ts"]);
  const newLine2 = tokens["src/a.ts"]!.new![2]!;
  expect(newLine2.map((t) => t.content).join("")).toBe("const b = 2;");
  expect(newLine2[0]!.style).toMatchObject({ "--shiki-light": expect.any(String), "--shiki-dark": expect.any(String) });
  expect(tokens["src/a.ts"]!.old![2]!.map((t) => t.content).join("")).toBe("let b = 2;");
});
