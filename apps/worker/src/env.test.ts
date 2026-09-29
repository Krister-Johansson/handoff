import { expect, test } from "vitest";
import { parseEnv } from "./env.ts";

const base = {
  DATABASE_URL: "postgres://x",
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-x",
  GITHUB_TOKEN: "ghp_x",
};

test("parseEnv applies defaults for home, caps and the claude binary", () => {
  const env = parseEnv(base);
  expect(env).toMatchObject({ HANDOFF_HOME: "./.handoff", HANDOFF_CLAUDE_BIN: "claude", caps: { cli: 1, shell: 4, github: 4, human: 1000, function: 8 } });
});

test("parseEnv names every missing required key", () => {
  expect(() => parseEnv({})).toThrow(/DATABASE_URL[\s\S]*CLAUDE_CODE_OAUTH_TOKEN/);
});

test("parseEnv requires a GitHub token or a complete GitHub App configuration", () => {
  expect(() => parseEnv({ ...base, GITHUB_TOKEN: undefined })).toThrow(/GITHUB_TOKEN or GITHUB_APP_ID/);
  expect(parseEnv({ ...base, GITHUB_TOKEN: undefined, GITHUB_APP_ID: "123", GITHUB_APP_PRIVATE_KEY_PATH: "/k.pem" }).github).toEqual({
    mode: "app",
    appId: 123,
    privateKeyPath: "/k.pem",
  });
});

test("parseEnv reads cap overrides", () => {
  expect(parseEnv({ ...base, HANDOFF_CAP_CLI: "3" }).caps.cli).toBe(3);
});
