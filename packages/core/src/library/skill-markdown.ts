import { parse, stringify } from "yaml";

export type ParsedSkill = { name?: string; description?: string; frontmatter: Record<string, unknown>; body: string };

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Splits a SKILL.md into its frontmatter and body. name and description are lifted out; every other
 * key (license, allowed-tools, metadata) is kept so it can be written back unchanged.
 */
export function parseSkillMarkdown(raw: string): ParsedSkill {
  const match = FRONTMATTER.exec(raw);
  if (!match) return { frontmatter: {}, body: raw.trim() };
  const data = parse(match[1] ?? "") as unknown;
  const meta = data && typeof data === "object" && !Array.isArray(data) ? { ...(data as Record<string, unknown>) } : {};
  const { name, description, ...frontmatter } = meta;
  return {
    ...(typeof name === "string" ? { name } : {}),
    ...(typeof description === "string" ? { description } : {}),
    frontmatter,
    body: (match[2] ?? "").trim(),
  };
}

/** A SKILL.md with name and description first, the other frontmatter keys after them, then the body. */
export function renderSkillMarkdown(skill: { name: string; description: string; frontmatter: Record<string, unknown>; body: string }): string {
  const yaml = stringify({ name: skill.name, description: skill.description.replace(/\s*\n\s*/g, " "), ...skill.frontmatter }, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${skill.body.trimEnd()}\n`;
}
