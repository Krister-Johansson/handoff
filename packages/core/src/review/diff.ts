/** One line of a diff hunk, numbered in the old file, the new file, or both. */
export type DiffLine = { kind: "add" | "del" | "context"; oldLine?: number; newLine?: number; text: string };
export type DiffHunk = { oldStart: number; newStart: number; header?: string; lines: DiffLine[] };

/**
 * A changed file on a branch. `blob` is the file's new git blob id (the old one for a deleted file),
 * so a person's "viewed" mark can tell whether it changed since. `whole` means the hunks hold the
 * entire file; `collapsed` says why a file has no lines to show.
 */
export type DiffFile = {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "binary";
  additions: number;
  deletions: number;
  blob?: string;
  hunks: DiffHunk[];
  whole?: boolean;
  collapsed?: "generated" | "large" | "limit";
};

const ZERO = /^0+$/;

const unquote = (p: string) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\") : p);
const strip = (p: string) => unquote(p.trim()).replace(/^[ab]\//, "");

/** Parses `git diff` output. It reads hunks by line prefix, so it does not rely on the hunk header counts. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let hunk: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const rest = line.slice("diff --git ".length);
      const half = rest.indexOf(" b/");
      file = { path: strip(half >= 0 ? rest.slice(half + 1) : rest), status: "modified", additions: 0, deletions: 0, hunks: [] };
      files.push(file);
      hunk = undefined;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (line.startsWith("new file mode")) file.status = "added";
      else if (line.startsWith("deleted file mode")) file.status = "deleted";
      else if (line.startsWith("rename from ")) {
        file.status = "renamed";
        file.oldPath = strip(line.slice("rename from ".length));
      } else if (line.startsWith("rename to ")) file.path = strip(line.slice("rename to ".length));
      else if (line.startsWith("index ")) {
        const [before = "", after = ""] = line.slice("index ".length).split(" ")[0]!.split("..");
        file.blob = ZERO.test(after) ? before : after;
      } else if (line.startsWith("Binary files ")) file.status = "binary";
      else if (line.startsWith("+++ ") && !line.startsWith("+++ /dev/null")) file.path = strip(line.slice(4));
    }
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      hunk = { oldStart: oldLine, newStart: newLine, ...(header[3] ? { header: header[3] } : {}), lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    const body = line.slice(1);
    if (line.startsWith("+")) {
      hunk.lines.push({ kind: "add", newLine: newLine++, text: body });
      file.additions++;
    } else if (line.startsWith("-")) {
      hunk.lines.push({ kind: "del", oldLine: oldLine++, text: body });
      file.deletions++;
    } else if (line.startsWith(" ")) {
      hunk.lines.push({ kind: "context", oldLine: oldLine++, newLine: newLine++, text: body });
    }
    // "\ No newline at end of file" and the trailing empty line carry nothing to show.
  }
  return files;
}

const GENERATED = [/(^|\/)pnpm-lock\.yaml$/, /(^|\/)package-lock\.json$/, /(^|\/)yarn\.lock$/, /(^|\/)bun\.lockb?$/, /\.gen\.[cm]?[jt]sx?$/, /\.min\.(js|css)$/];

export const isGeneratedPath = (path: string) => GENERATED.some((r) => r.test(path));

const lineCount = (file: DiffFile) => file.hunks.reduce((n, h) => n + h.lines.length, 0);

/** Keeps `context` unchanged lines around each change and splits the rest into separate hunks. */
export function trimContext(file: DiffFile, context = 3): DiffFile {
  const lines = file.hunks.flatMap((h) => h.lines);
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.kind === "context") return;
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep[j] = true;
  });
  const hunks: DiffHunk[] = [];
  let current: DiffLine[] | undefined;
  lines.forEach((l, i) => {
    if (!keep[i]) {
      current = undefined;
      return;
    }
    if (!current) {
      current = [];
      const first = l;
      const before = lines.slice(0, i);
      const oldStart = first.oldLine ?? (before.findLast((b) => b.oldLine !== undefined)?.oldLine ?? 0) + 1;
      const newStart = first.newLine ?? (before.findLast((b) => b.newLine !== undefined)?.newLine ?? 0) + 1;
      hunks.push({ oldStart, newStart, lines: current });
    }
    current.push(l);
  });
  return { ...file, hunks, whole: false };
}

export type DiffLimits = { maxFileLines?: number; maxTotalLines?: number };

/**
 * Keeps a diff snapshot small enough to store with a review question: generated files and lock files
 * keep only their counts, a file too long to show whole keeps three lines of context, and once the
 * snapshot is full later files lose context and then their lines.
 */
export function limitDiff(files: DiffFile[], { maxFileLines = 1_500, maxTotalLines = 15_000 }: DiffLimits = {}): DiffFile[] {
  let total = 0;
  return files.map((file): DiffFile => {
    if (file.status === "binary") return { ...file, hunks: [] };
    if (isGeneratedPath(file.path)) return { ...file, hunks: [], collapsed: "generated" };
    const onlyChanges = file.hunks.every((h) => h.lines.every((l) => l.kind !== "context"));
    let shown: DiffFile = { ...file, whole: true };
    if (lineCount(shown) > maxFileLines || total + lineCount(shown) > maxTotalLines) shown = onlyChanges ? { ...file, whole: false } : trimContext(file);
    if (lineCount(shown) > maxFileLines) return { ...file, hunks: [], whole: false, collapsed: "large" };
    if (total + lineCount(shown) > maxTotalLines) return { ...file, hunks: [], whole: false, collapsed: "limit" };
    total += lineCount(shown);
    return shown;
  });
}
