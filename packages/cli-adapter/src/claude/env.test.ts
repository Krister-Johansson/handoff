import { expect, test } from "vitest";
import { buildClaudeEnv } from "./env.ts";

test("buildClaudeEnv passes the subscription token and config dir and drops API keys and unrelated vars", () => {
  const env = buildClaudeEnv({
    oauthToken: "sk-ant-oat01-test",
    configDir: "/h/claude-config",
    base: { PATH: "/bin", HOME: "/home/u", ANTHROPIC_API_KEY: "sk-ant-api", GITHUB_TOKEN: "ghs", FAKE_CLAUDE_SCENARIO: "/s" },
    passthrough: ["FAKE_CLAUDE_SCENARIO"],
  });
  expect(env).toMatchObject({
    PATH: "/bin",
    HOME: "/home/u",
    CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-test",
    CLAUDE_CONFIG_DIR: "/h/claude-config",
    FAKE_CLAUDE_SCENARIO: "/s",
  });
  expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
  expect(env).not.toHaveProperty("GITHUB_TOKEN");
});
