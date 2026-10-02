import { expect, test } from "vitest";
import { buildAssistantEnv, buildClaudeEnv } from "./env.ts";

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

test("the assistant's environment keeps the MCP discovery cache off", () => {
  // The assistant's MCP server has the same name and URL every turn, so a cached tool list would hide the open page's tools.
  const input = { oauthToken: "sk-ant-oat01-test", configDir: "/h/assistant/claude-config", base: { PATH: "/bin", MCP_DISCOVERY_CACHE: "1" }, passthrough: ["MCP_DISCOVERY_CACHE"] };
  expect(buildAssistantEnv(input)).toMatchObject({ PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-test", CLAUDE_CONFIG_DIR: "/h/assistant/claude-config", MCP_DISCOVERY_CACHE: "0" });
  expect(buildAssistantEnv({ ...input, base: { PATH: "/bin" }, passthrough: [] })).toHaveProperty("MCP_DISCOVERY_CACHE", "0");
});
