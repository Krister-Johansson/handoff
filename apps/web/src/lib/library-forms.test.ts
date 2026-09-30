import { expect, test } from "vitest";
import { parseAgentForm, parseMcpForm, parseSkillForm } from "./library-forms";

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
};

test("parseSkillForm accepts a name, description and body", () => {
  expect(parseSkillForm(form({ name: "tdd", description: "Test first", body: "Write the test." }))).toEqual({
    ok: true,
    data: { name: "tdd", description: "Test first", body: "Write the test.", frontmatter: {}, files: [] },
  });
});

test("parseSkillForm reads the other frontmatter as YAML and the supporting files as JSON", () => {
  const result = parseSkillForm(
    form({
      name: "tdd",
      description: "Test first",
      body: "b",
      frontmatter: "license: MIT\nmetadata:\n  author: ann\n",
      files: JSON.stringify([{ path: "mocking.md", content: "# Mocks" }, { path: "agents/openai.yaml", content: "x: 1" }]),
    }),
  );
  expect(result).toEqual({
    ok: true,
    data: {
      name: "tdd",
      description: "Test first",
      body: "b",
      frontmatter: { license: "MIT", metadata: { author: "ann" } },
      files: [
        { path: "mocking.md", content: "# Mocks" },
        { path: "agents/openai.yaml", content: "x: 1" },
      ],
    },
  });
});

test("parseSkillForm refuses frontmatter that is not a YAML mapping, and unsafe or duplicate file paths", () => {
  const errorsOf = (entries: Record<string, string>) => {
    const r = parseSkillForm(form({ name: "tdd", description: "d", body: "b", ...entries }));
    return r.ok ? {} : r.errors;
  };
  expect(errorsOf({ frontmatter: "- a\n- b" })).toHaveProperty("frontmatter");
  expect(errorsOf({ frontmatter: "name: other" })).toHaveProperty("frontmatter");
  expect(errorsOf({ files: JSON.stringify([{ path: "../escape.md", content: "" }]) })).toHaveProperty("files");
  expect(errorsOf({ files: JSON.stringify([{ path: "/abs.md", content: "" }]) })).toHaveProperty("files");
  expect(errorsOf({ files: JSON.stringify([{ path: "SKILL.md", content: "" }]) })).toHaveProperty("files");
  expect(errorsOf({ files: JSON.stringify([{ path: "a.md", content: "" }, { path: "a.md", content: "" }]) })).toHaveProperty("files");
});

test("parseSkillForm rejects names that are not lowercase kebab case", () => {
  const result = parseSkillForm(form({ name: "My Skill", description: "d", body: "b" }));
  expect(result.ok).toBe(false);
  expect(result.ok ? {} : result.errors).toHaveProperty("name");
});

test("parseMcpForm reads args per line and env as KEY=VALUE lines", () => {
  const result = parseMcpForm(
    form({ name: "docs", transport: "stdio", command: "npx", args: "-y\ndocs-mcp\n", env: "API_KEY=${secret:DOCS_KEY}\nMODE=fast", tools: "search, fetch" }),
  );
  expect(result).toEqual({
    ok: true,
    data: { name: "docs", transport: "stdio", command: "npx", args: ["-y", "docs-mcp"], url: null, env: { API_KEY: "${secret:DOCS_KEY}", MODE: "fast" }, headers: {}, tools: ["search", "fetch"] },
  });
});

test("parseMcpForm requires a command for stdio and a URL for http", () => {
  expect(parseMcpForm(form({ name: "a", transport: "stdio" })).ok).toBe(false);
  expect(parseMcpForm(form({ name: "a", transport: "http" })).ok).toBe(false);
  expect(parseMcpForm(form({ name: "a", transport: "http", url: "https://mcp.example.com", headers: "Authorization: Bearer ${secret:T}" }))).toMatchObject({
    ok: true,
    data: { headers: { Authorization: "Bearer ${secret:T}" } },
  });
});

test("parseMcpForm refuses a pasted credential and asks for a secret reference", () => {
  const result = parseMcpForm(form({ name: "gh", transport: "stdio", command: "npx", env: "TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789" }));
  expect(result.ok).toBe(false);
  expect(result.ok ? "" : result.errors.env).toMatch(/\$\{secret:NAME\}/);
});

test("parseAgentForm reads tools as a comma list and an optional model", () => {
  expect(parseAgentForm(form({ name: "explorer", description: "Finds code", prompt: "Search.", tools: "Read, Grep", model: "" }))).toEqual({
    ok: true,
    data: { name: "explorer", description: "Finds code", prompt: "Search.", tools: ["Read", "Grep"], model: null },
  });
});
