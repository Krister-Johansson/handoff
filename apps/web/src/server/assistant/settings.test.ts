import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { assistantState, writeAssistantSettings } from "./settings";

const env = (extra: Record<string, string> = {}) => ({ HANDOFF_HOME: mkdtempSync(join(tmpdir(), "handoff-home-")), ...extra });

test("the assistant is on with the environment's model until its settings say otherwise", () => {
  const e = env({ CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-test", HANDOFF_ASSISTANT_MODEL: "sonnet" });
  expect(assistantState(e)).toMatchObject({ available: true, enabled: true, config: { model: "sonnet" } });
  writeAssistantSettings(assistantState(e).config.home, { model: "haiku" });
  expect(assistantState(e)).toMatchObject({ available: true, config: { model: "haiku" }, settings: { model: "haiku" } });
  writeAssistantSettings(assistantState(e).config.home, { enabled: false });
  expect(assistantState(e)).toMatchObject({ available: false, reason: "off", settings: { enabled: false, model: "haiku" } });
  expect(statSync(join(assistantState(e).config.home, "settings.json")).mode & 0o777).toBe(0o600);
});

test("without a token the assistant is unavailable whatever its settings say", () => {
  expect(assistantState(env())).toMatchObject({ available: false, reason: "no-token" });
});

test("a model the settings do not know is refused", () => {
  expect(() => writeAssistantSettings(assistantState(env()).config.home, { model: "gpt" as never })).toThrow(/sonnet, opus or haiku/);
});
