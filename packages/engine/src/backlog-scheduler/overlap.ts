import { and, asc, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { RunStateSchema } from "@handoff/core";
import { runs, type DbExecutor } from "@handoff/db";
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

/** An active run of the same project whose owned paths a run shares, with the shared paths. */
export type Overlap = { runId: string; paths: string[] };

/**
 * The first other active run of the project, oldest first, whose plan owns paths this run's plan
 * also owns. Runs without a plan own nothing yet. A run the scheduler started yields only to runs
 * started before it and to runs a person started, which are never held, so two held runs never wait
 * on each other.
 */
export async function overlapWith(db: DbExecutor, run: { id: string; projectId: string; createdAt: Date }, ownedPaths: string[]): Promise<Overlap | undefined> {
  const others = await db
    .select({ id: runs.id, state: runs.state })
    .from(runs)
    .where(
      and(
        eq(runs.projectId, run.projectId),
        ne(runs.id, run.id),
        inArray(runs.status, ["queued", "running", "waiting"]),
        or(lt(runs.createdAt, run.createdAt), isNull(runs.startedBy), ne(runs.startedBy, "scheduler")),
      ),
    )
    .orderBy(asc(runs.createdAt));
  for (const other of others) {
    const paths = overlaps(ownedPaths, RunStateSchema.parse(other.state).plan?.ownedPaths ?? []);
    if (paths.length > 0) return { runId: other.id, paths };
  }
  return undefined;
}
