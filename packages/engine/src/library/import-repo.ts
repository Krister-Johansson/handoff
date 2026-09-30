import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { parseSkillMarkdown } from "@handoff/core";
import { getLibraryByNames, upsertGroup, upsertSkill, type DbExecutor, type SkillFile } from "@handoff/db";

const run = promisify(execFile);

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv"]);
const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/;

export type RepoImportInput = {
  /** owner/name on GitHub. */
  repo: string;
  /** Group to create or update with the imported skills. */
  group: string;
  /** Clone URL; defaults to https://github.com/<repo>.git. Tests pass a local path. */
  url?: string;
  /** GIT_CONFIG_* variables that authenticate the clone, for private repositories. */
  gitEnv?: Record<string, string>;
};

export type RepoImportSkill =
  | { name: string; path: string; status: "imported" | "updated" | "unchanged"; version: number }
  | { name: string; path: string; status: "skipped"; reason: string };

export type RepoImportReport = { repo: string; group: string; skills: RepoImportSkill[] };

/** Folders under `dir` that contain a SKILL.md, relative to it. */
function skillFolders(dir: string, at = "", depth = 0): string[] {
  const here = join(dir, at);
  const entries = readdirSync(here, { withFileTypes: true });
  const found = entries.some((e) => e.isFile() && e.name === "SKILL.md") ? [at] : [];
  if (depth >= 6) return found;
  return [...found, ...entries.filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name)).flatMap((e) => skillFolders(dir, join(at, e.name), depth + 1))];
}

/** Text files as they are; anything that is not UTF-8 text (fonts, images) as base64. */
function readSkillFile(path: string, rel: string): SkillFile {
  const bytes = readFileSync(path);
  const text = bytes.toString("utf8");
  const isText = !bytes.includes(0) && Buffer.from(text, "utf8").equals(bytes);
  return isText ? { path: rel, content: text } : { path: rel, content: bytes.toString("base64"), encoding: "base64" };
}

/** Every file of a skill folder except SKILL.md and nested skills' folders. */
function skillFiles(folder: string, nested: Set<string>, at = ""): SkillFile[] {
  return readdirSync(join(folder, at), { withFileTypes: true }).flatMap((entry) => {
    const rel = join(at, entry.name);
    const full = join(folder, rel);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) || nested.has(full) ? [] : skillFiles(folder, nested, rel);
    if (rel === "SKILL.md" || statSync(full).size > MAX_FILE_BYTES) return [];
    return [readSkillFile(full, rel)];
  });
}

/**
 * Imports every folder with a SKILL.md in a GitHub repository as a library skill, then makes a group
 * of them. Each skill records its folder's git tree hash, so importing again only versions skills
 * that changed. A library skill of the same name from elsewhere is skipped, never overwritten.
 */
export async function importSkillRepository(db: DbExecutor, input: RepoImportInput): Promise<RepoImportReport> {
  const dir = mkdtempSync(join(tmpdir(), "handoff-repo-import-"));
  try {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", ...input.gitEnv };
    await run("git", ["clone", "-q", "--depth", "1", input.url ?? `https://github.com/${input.repo}.git`, dir], { env });
    const folders = skillFolders(dir).sort();
    if (folders.length === 0) throw new Error(`${input.repo} has no SKILL.md files`);
    const nested = new Set(folders.map((f) => join(dir, f)));

    const skills: RepoImportSkill[] = [];
    for (const folder of folders) {
      const parsed = parseSkillMarkdown(readFileSync(join(dir, folder, "SKILL.md"), "utf8"));
      const name = (parsed.name ?? basename(folder || input.repo)).toLowerCase();
      const path = folder || ".";
      if (!SKILL_NAME.test(name)) {
        skills.push({ name, path, status: "skipped", reason: "its name is not lowercase letters, digits and dashes" });
        continue;
      }
      const id = folder ? `${input.repo}/${folder}` : input.repo;
      const hash = (await run("git", ["rev-parse", `HEAD:${folder}`], { cwd: dir })).stdout.trim();
      const [existing] = (await getLibraryByNames(db, { skills: [name], mcp: [], agents: [] })).skills;
      if (existing && existing.source?.id !== id) {
        skills.push({ name, path, status: "skipped", reason: `the library already has a skill named ${name} from ${existing.source?.id ?? "the library itself"}` });
        continue;
      }
      if (existing && existing.source?.hash === hash) {
        skills.push({ name, path, status: "unchanged", version: existing.version });
        continue;
      }
      const row = await upsertSkill(db, {
        name,
        description: parsed.description ?? "",
        body: parsed.body,
        frontmatter: parsed.frontmatter,
        files: skillFiles(join(dir, folder), new Set([...nested].filter((n) => n !== join(dir, folder) && n.startsWith(join(dir, folder))))),
        source: { registry: "github", id, hash },
      });
      skills.push({ name, path, status: existing ? "updated" : "imported", version: row.version });
    }

    const names = skills.filter((s) => s.status !== "skipped").map((s) => s.name).sort();
    if (names.length) {
      await upsertGroup(db, { name: input.group, description: `Skills from github.com/${input.repo}`, skills: names, mcp: [], agents: [] });
    }
    return { repo: input.repo, group: input.group, skills };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
