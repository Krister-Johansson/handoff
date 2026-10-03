import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { removeSessionTranscripts } from "./transcripts.ts";

test("removes each session's transcript and its folder from every projects folder, and nothing else", () => {
  const configDir = mkdtempSync(join(tmpdir(), "claude-config-"));
  const gone = "aaaaaaaa-0000-4000-8000-000000000001";
  const kept = "aaaaaaaa-0000-4000-8000-000000000002";
  const one = join(configDir, "projects", "-Users-x--handoff-assistant-cwd");
  const two = join(configDir, "projects", "-tmp-other");
  mkdirSync(join(one, gone), { recursive: true });
  mkdirSync(two, { recursive: true });
  writeFileSync(join(one, `${gone}.jsonl`), "{}");
  writeFileSync(join(two, `${gone}.jsonl`), "{}");
  writeFileSync(join(one, `${kept}.jsonl`), "{}");

  const removed = removeSessionTranscripts(configDir, [gone]);
  expect(removed.sort()).toEqual([join(one, gone), join(one, `${gone}.jsonl`), join(two, `${gone}.jsonl`)].sort());
  expect(existsSync(join(one, `${kept}.jsonl`))).toBe(true);
  expect(existsSync(join(one, `${gone}.jsonl`))).toBe(false);
});

test("no sessions, or no projects folder yet, removes nothing", () => {
  const configDir = mkdtempSync(join(tmpdir(), "claude-config-"));
  expect(removeSessionTranscripts(configDir, ["aaaaaaaa-0000-4000-8000-000000000001"])).toEqual([]);
  mkdirSync(join(configDir, "projects", "p"), { recursive: true });
  writeFileSync(join(configDir, "projects", "p", "x.jsonl"), "{}");
  expect(removeSessionTranscripts(configDir, [])).toEqual([]);
  expect(existsSync(join(configDir, "projects", "p", "x.jsonl"))).toBe(true);
});

test("a session id that is not a plain id removes nothing", () => {
  const configDir = mkdtempSync(join(tmpdir(), "claude-config-"));
  mkdirSync(join(configDir, "projects", "p"), { recursive: true });
  writeFileSync(join(configDir, "projects", "p", "x.jsonl"), "{}");
  expect(removeSessionTranscripts(configDir, ["../p", ""])).toEqual([]);
});
