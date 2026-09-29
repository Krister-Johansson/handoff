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
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data: { name, description, body } };
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
