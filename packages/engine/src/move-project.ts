import { and, eq, inArray, ne, projects, projectSchedulers, runs, schedulerEvents, sql, type Db } from "@handoff/db";
import type { GitHubPort } from "@handoff/github";

const ACTIVE = ["queued", "running", "waiting"] as const;

/** What a move needs: the database, and GitHub to read the repository's id. Without GitHub the id is not checked. */
export type MoveProjectDeps = { db: Db; github: GitHubPort | undefined };

/** What moving a project changed, and the plan it had, so the person can set up the plan again with copy_from. */
export type MovedProject = {
  /** The repository the project uses now, owner/name. */
  repo: string;
  /** The repository it used before, owner/name. */
  from: string;
  /** The plan's GitHub Project before the move, of the old owner; null without a plan. */
  plan: { owner: string; number: number } | null;
  /** Whether the plan's Project was forgotten because another owner holds it. */
  planUnlinked: boolean;
  /** Whether the move paused the project's scheduler. */
  schedulerPaused: boolean;
};

/** The sentence a moved project's scheduler pauses with. */
export const movedReason = (owner: string) => `The repository moved to ${owner}. Set up the plan again, then resume.`;

/**
 * Points a project at its repository's new place after GitHub moved the repository, for example from a user to an
 * organization (docs/plans/organizations.md, Decision 9). Refuses while the project has active runs, and when GitHub
 * gives the repository another id than the one the project stores. Updates the owner and name, rewrites the
 * repository part of each run's issue URLs, and, when the owner changed, forgets the plan's GitHub Project (it belongs
 * to the old owner) and pauses the scheduler with the reason. Runs, graphs, pins and the scheduler's settings stay.
 */
export async function moveProject(deps: MoveProjectDeps, projectId: string, repo: string, actor = "person"): Promise<MovedProject> {
  const [owner, name, extra] = repo.trim().split("/");
  if (!owner || !name || extra !== undefined) throw new Error("Repository must look like owner/name.");
  const target = `${owner}/${name}`;
  let repoId: number | undefined;
  if (deps.github) {
    try {
      repoId = await deps.github.getRepoId({ owner, name });
    } catch {
      throw new Error(`GitHub cannot find ${target} with the configured credentials.`);
    }
  }

  return deps.db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    if (!project) throw new Error("The project no longer exists.");
    const from = `${project.repoOwner}/${project.repoName}`;
    if (from === target) throw new Error(`${project.name} already uses ${target}.`);

    const active = (await tx.select({ id: runs.id }).from(runs).where(and(eq(runs.projectId, projectId), inArray(runs.status, [...ACTIVE])))).length;
    if (active > 0) {
      throw new Error(`The project has ${active} active run${active === 1 ? "" : "s"}. Let ${active === 1 ? "it" : "them"} finish or cancel ${active === 1 ? "it" : "them"}, then move the repository.`);
    }
    if (repoId !== undefined && project.repoId !== null && project.repoId !== repoId) {
      throw new Error(`${target} is another repository than the one this project was added with.`);
    }
    const [taken] = await tx
      .select({ name: projects.name })
      .from(projects)
      .where(and(ne(projects.id, projectId), sql`(lower(${projects.repoOwner}) = lower(${owner}) and lower(${projects.repoName}) = lower(${name}))${repoId !== undefined ? sql` or ${projects.repoId} = ${repoId}` : sql``}`));
    if (taken) throw new Error(`${target} is already the project ${taken.name}.`);

    const ownerChanged = project.repoOwner.toLowerCase() !== owner.toLowerCase();
    const plan = project.planProjectNumber === null ? null : { owner: project.repoOwner, number: project.planProjectNumber };
    const planUnlinked = ownerChanged && plan !== null;
    await tx
      .update(projects)
      .set({ repoOwner: owner, repoName: name, ...(repoId !== undefined ? { repoId } : {}), ...(planUnlinked ? { planProjectNumber: null } : {}), updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    // Issue links name the repository; GitHub redirects the old ones, but the dashboard should not lean on that.
    const oldPrefix = `https://github.com/${from}/`.toLowerCase();
    const linked = await tx.select({ id: runs.id, issues: runs.issues }).from(runs).where(and(eq(runs.projectId, projectId), sql`jsonb_array_length(${runs.issues}) > 0`));
    for (const run of linked) {
      const issues = run.issues.map((issue) => (issue.url.toLowerCase().startsWith(oldPrefix) ? { ...issue, url: `https://github.com/${target}/${issue.url.slice(oldPrefix.length)}` } : issue));
      if (issues.some((issue, index) => issue !== run.issues[index])) await tx.update(runs).set({ issues }).where(eq(runs.id, run.id));
    }

    let schedulerPaused = false;
    const [scheduler] = await tx.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId)).for("update");
    if (ownerChanged && scheduler?.enabled) {
      const reason = movedReason(owner);
      await tx
        .update(projectSchedulers)
        .set({ pausedAt: scheduler.pausedAt ?? sql`now()`, pausedBy: "person", pauseReason: reason, updatedAt: new Date() })
        .where(eq(projectSchedulers.projectId, projectId));
      await tx.insert(schedulerEvents).values({ projectId, type: "scheduler.paused", payload: { by: actor, reason } });
      schedulerPaused = true;
    }
    return { repo: target, from, plan, planUnlinked, schedulerPaused };
  });
}
