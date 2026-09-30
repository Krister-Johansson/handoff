import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { AgentTokenStore } from "./agent-token";

let store: AgentTokenStore;
let file: string;
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), "handoff-agent-")), "nested", "agent-token");
  store = new AgentTokenStore(file);
});

test("agent connections are off until a token is created, which only its owner can read", () => {
  expect(store.read()).toBeUndefined();
  expect(store.verify("Bearer anything")).toBe(false);
  const token = store.create();
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(store.read()).toBe(token);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(store.create()).toBe(token);
});

test("a request is let in only with the token as a bearer header", () => {
  const token = store.create();
  expect(store.verify(`Bearer ${token}`)).toBe(true);
  expect(store.verify(`Bearer ${token}x`)).toBe(false);
  expect(store.verify(token)).toBe(false);
  expect(store.verify(null)).toBe(false);
});

test("regenerating replaces the token, and disabling removes it", () => {
  const first = store.create();
  const second = store.regenerate();
  expect(second).not.toBe(first);
  expect(store.verify(`Bearer ${first}`)).toBe(false);
  store.disable();
  expect(existsSync(file)).toBe(false);
  expect(store.verify(`Bearer ${second}`)).toBe(false);
});
