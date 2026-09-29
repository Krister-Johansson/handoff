import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { checkClaudeVersion } from "./claude-version.ts";

function fakeBin(output: string) {
  const path = join(mkdtempSync(join(tmpdir(), "claude-v-")), "claude");
  writeFileSync(path, `#!/bin/sh\necho "${output}"\n`);
  chmodSync(path, 0o755);
  return path;
}

test("checkClaudeVersion accepts the pinned version", async () => {
  expect(await checkClaudeVersion(fakeBin("2.1.285 (Claude Code)"), "2.1.285", false)).toEqual({ version: "2.1.285" });
});

test("checkClaudeVersion refuses a different version unless drift is allowed", async () => {
  const bin = fakeBin("2.2.0 (Claude Code)");
  await expect(checkClaudeVersion(bin, "2.1.285", false)).rejects.toThrow(/2\.2\.0.*2\.1\.285/);
  expect(await checkClaudeVersion(bin, "2.1.285", true)).toEqual({ version: "2.2.0", drift: true });
});
