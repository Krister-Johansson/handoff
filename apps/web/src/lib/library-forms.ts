import { parse as parseYaml } from "yaml";
import { looksLikeSecret } from "@handoff/core";
import type { AgentInput, McpServerInput, SkillInput } from "@handoff/db";

export type FormResult<T> = { ok: true; data: T } | { ok: false; errors: Record<string, string> };

const NAME = /^[a-z0-9][a-z0-9-]*$/;
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const lines = (value: string) =>
  value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
const list = (value: string) =>
  value
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);

function pairs(value: string, separator: "=" | ":", errors: Record<string, string>, field: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines(value)) {
    const at = line.indexOf(separator);
    if (at <= 0) {
      errors[field] = `Each line must look like KEY${separator === "=" ? "=" : ": "}value`;
      continue;
    }
    const key = line.slice(0, at).trim();
    const val = line.slice(at + 1).trim();
    if (looksLikeSecret(val)) errors[field] = `${key} looks like a pasted credential. Store it in the worker environment and write \${secret:NAME} here.`;
    out[key] = val;
  }
  return out;
}

function checkName(name: string, errors: Record<string, string>) {
  if (!NAME.test(name)) errors.name = "Use lowercase letters, digits and dashes, for example ci-triage.";
}

export function parseSkillForm(form: FormData): FormResult<SkillInput> {
  const errors: Record<string, string> = {};
  const name = text(form, "name");
  checkName(name, errors);
  const description = text(form, "description");
  const body = text(form, "body");
  if (!description) errors.description = "Say when Claude should use this skill.";
  if (!body) errors.body = "The skill needs instructions.";
  const frontmatter = skillFrontmatter(text(form, "frontmatter"), errors);
  const files = skillFiles(text(form, "files"), errors);
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data: { name, description, body, frontmatter, files } };
}

/** SKILL.md frontmatter keys other than name and description, written as YAML. */
function skillFrontmatter(value: string, errors: Record<string, string>): Record<string, unknown> {
  if (!value) return {};
  let data: unknown;
  try {
    data = parseYaml(value);
  } catch (error) {
    errors.frontmatter = `Not valid YAML: ${(error as Error).message.split("\n")[0]}`;
    return {};
  }
  if (data === null || data === undefined) return {};
  if (typeof data !== "object" || Array.isArray(data)) {
    errors.frontmatter = "Write the frontmatter as key: value lines.";
    return {};
  }
  if ("name" in data || "description" in data) errors.frontmatter = "Name and description have their own fields.";
  return data as Record<string, unknown>;
}

/** Supporting files as JSON [{ path, content }], with relative paths inside the skill folder. */
function skillFiles(value: string, errors: Record<string, string>): { path: string; content: string }[] {
  if (!value) return [];
  let data: unknown;
  try {
    data = JSON.parse(value);
  } catch {
    errors.files = "The supporting files could not be read.";
    return [];
  }
  const files = Array.isArray(data) ? data.filter((f): f is { path: string; content: string } => typeof f?.path === "string" && typeof f?.content === "string") : [];
  const seen = new Set<string>();
  for (const { path } of files) {
    const parts = path.split("/");
    if (!path || path.startsWith("/") || parts.some((p) => p === ".." || p === "")) errors.files = `${path || "(empty)"} is not a path inside the skill folder.`;
    else if (path === "SKILL.md") errors.files = "SKILL.md is the instructions; add other files next to it.";
    else if (seen.has(path)) errors.files = `${path} appears twice.`;
    seen.add(path);
  }
  return files.map(({ path, content }) => ({ path, content }));
}

export function parseMcpForm(form: FormData): FormResult<McpServerInput> {
  const errors: Record<string, string> = {};
  const name = text(form, "name");
  checkName(name, errors);
  const transport = text(form, "transport") === "http" ? "http" : "stdio";
  const command = text(form, "command");
  const url = text(form, "url");
  if (transport === "stdio" && !command) errors.command = "A stdio server needs a command.";
  if (transport === "http" && !/^https?:\/\//.test(url)) errors.url = "An http server needs a URL.";
  const env = pairs(text(form, "env"), "=", errors, "env");
  const headers = pairs(text(form, "headers"), ":", errors, "headers");
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    data: {
      name,
      transport,
      command: transport === "stdio" ? command : null,
      args: transport === "stdio" ? lines(text(form, "args")) : [],
      url: transport === "http" ? url : null,
      env,
      headers,
      tools: list(text(form, "tools")),
    },
  };
}

export function parseAgentForm(form: FormData): FormResult<AgentInput> {
  const errors: Record<string, string> = {};
  const name = text(form, "name");
  checkName(name, errors);
  const description = text(form, "description");
  const prompt = text(form, "prompt");
  if (!description) errors.description = "Say when Claude should delegate to this agent.";
  if (!prompt) errors.prompt = "The agent needs a prompt.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data: { name, description, prompt, tools: list(text(form, "tools")), model: text(form, "model") || null } };
}
