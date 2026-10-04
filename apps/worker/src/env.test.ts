import { expect, test } from "vitest";
import { dockerOptionsFromEnv } from "@handoff/engine";
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

test("parseEnv defaults to worktrees and reads the Docker settings", () => {
  expect(parseEnv(base).HANDOFF_WORKSPACE).toBe("worktree");
  expect(parseEnv({ ...base, HANDOFF_WORKSPACE: "docker", HANDOFF_DOCKER_IMAGE: "img:1" })).toMatchObject({ HANDOFF_WORKSPACE: "docker", docker: { image: "img:1" } });
});

test("parseEnv reads the Docker options the dashboard reads, with dockerOptionsFromEnv", () => {
  const source = { ...base, HANDOFF_HOME: "/h", HANDOFF_DOCKER_MOUNTS: "/cache", HANDOFF_DOCKER_NETWORK: "egress" };
  expect(parseEnv(source).docker).toEqual(dockerOptionsFromEnv(source));
  expect(parseEnv(source).docker).toMatchObject({ mounts: ["/h", "/cache"], network: "egress" });
});
