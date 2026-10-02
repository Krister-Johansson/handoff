import { baseOf, dirOf, LOCKFILES, WORKSPACE_FILE } from "../contract/package-files.ts";

const hasGlob = (p: string) => /[*?[{]/.test(p);

/** The part of the tree a path owns: the path itself, or for a glob the directory before its first pattern. */
function region(path: string): string {
  const clean = path.replace(/\/+$/, "");
  const segments = clean.split("/");
  const fixed = hasGlob(clean) ? segments.slice(0, segments.findIndex(hasGlob)) : segments;
  const joined = fixed.join("/");
  return joined === "." ? "" : joined;
}

/** Whether the region `outer` holds `inner`: the same path, a directory above it, or the whole repository. */
const holds = (outer: string, inner: string) => outer === "" || outer === inner || inner.startsWith(`${outer}/`);

/**
 * The package manager units a path owns, as directories: package.json owns the lockfiles next to it
 * and, in a workspace, the lockfile and pnpm-workspace.yaml at the root; a lockfile or the workspace
 * file is the unit of its own directory.
 */
function units(path: string): string[] {
  if (hasGlob(path)) return [];
  const file = baseOf(path);
  if (file === "package.json") return [...new Set([dirOf(path), ""])];
  if (LOCKFILES.has(file) || (file === WORKSPACE_FILE && dirOf(path) === "")) return [dirOf(path)];
  return [];
}

const isPackageJson = (path: string) => !hasGlob(path) && baseOf(path) === "package.json";

/**
 * The paths two sets of owned paths share, as `outsideOwned` counts ownership: a directory owns the
 * files under it, a file owns itself, and package manager files count as one unit with package.json.
 * Each shared path is the narrower of the two that meet, so it names what both runs would change.
 * Two package.json files that meet only at the root lockfile are both named.
 */
export function overlaps(paths: string[], others: string[]): string[] {
  const shared = new Set<string>();
  for (const mine of paths) {
    for (const theirs of others) {
      const a = region(mine);
      const b = region(theirs);
      if (holds(a, b)) shared.add(theirs);
      else if (holds(b, a)) shared.add(mine);
      else if (units(mine).some((unit) => units(theirs).includes(unit))) {
        if (!isPackageJson(theirs)) shared.add(theirs);
        else if (!isPackageJson(mine)) shared.add(mine);
        else shared.add(mine).add(theirs);
      }
    }
  }
  return [...shared];
}
