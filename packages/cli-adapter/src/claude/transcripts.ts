import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const SESSION_ID = /^[A-Za-z0-9-]+$/;

/**
 * Claude Code keeps a transcript per session under CLAUDE_CONFIG_DIR/projects/<encoded cwd>: a
 * <session id>.jsonl, and sometimes a folder of the same name. Removes those of the given sessions from
 * every projects folder, and returns the paths it removed.
 */
export function removeSessionTranscripts(configDir: string, sessionIds: Iterable<string>): string[] {
  const sessions = new Set([...sessionIds].filter((id) => SESSION_ID.test(id)));
  const root = join(configDir, "projects");
  if (!sessions.size || !existsSync(root)) return [];
  const removed: string[] = [];
  for (const project of readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    for (const entry of readdirSync(join(root, project.name))) {
      if (!sessions.has(entry.replace(/\.jsonl$/, ""))) continue;
      const path = join(root, project.name, entry);
      rmSync(path, { recursive: true, force: true });
      removed.push(path);
    }
  }
  return removed;
}
