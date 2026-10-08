import linear from "@handoff/core/templates/linear.graph.json" with { type: "json" };
import loop from "@handoff/core/templates/loop.graph.json" with { type: "json" };
import planReview from "@handoff/core/templates/plan-review.graph.json" with { type: "json" };
import { RunStateSchema, suggestProjectName, validateGraphForSave, type CompileError } from "@handoff/core";
import { and, desc, eq, graphs, graphVersions, inArray, projects, questions, runs, sql, type Db } from "@handoff/db";
import { cancelRun, splitPartsOf, splitRun, statusesBeforeRun, type SplitIssue } from "@handoff/engine/operations";
import { branchHasWork, previousRunOf } from "@handoff/engine/runs";
import { splitOfRun } from "@handoff/engine/split";
import { startRun, type StartRunInput } from "@handoff/engine/start-run";
import { PLAN_KINDS, type GitHubPort, type ProjectsPort } from "@handoff/github";

export const TEMPLATES = {
  plan: { label: "Plan, review, approve, build: a reviewer and you approve the plan before any code, and you try UI changes before the PR", document: planReview },
  linear: { label: "Plan, code, PR, merge", document: linear },
  loop: { label: "Plan, code, test, review, PR, merge with retry loops, and a demo and Try it for UI changes", document: loop },
  empty: {
    label: "Empty: a Start node to build from",
    document: { attributes: { startNode: "start" }, nodes: [{ key: "start", attributes: { type: "start", label: "Start", config: { trigger: "run" }, x: 0, y: 0 } }], edges: [] },
  },
} as const;
export type TemplateName = keyof typeof TEMPLATES;

export async function listProjects(db: Db) {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      repoOwner: projects.repoOwner,
      repoName: projects.repoName,
      defaultBranch: projects.defaultBranch,
      isDemo: projects.isDemo,
      planMode: projects.planMode,
      runCount: sql<number>`(select count(*)::int from runs r where r.project_id = "projects"."id")`,
      activeRuns: sql<number>`(select count(*)::int from runs r where r.project_id = "projects"."id" and r.status in ('queued','running','waiting'))`,
      waitingRuns: sql<number>`(select count(*)::int from runs r where r.project_id = "projects"."id" and r.status = 'waiting')`,
    })
    .from(projects)
    .orderBy(projects.name);
}

/**
 * Refuses a repository whose GitHub id a project stores already. Under another name it is a repository GitHub moved,
 * for example to an organization, and the sentence names the project and how to move it.
 */
async function refuseKnownRepository(db: Db, repo: string, repoId: number) {
  const [known] = await db.select({ name: projects.name, repoOwner: projects.repoOwner, repoName: projects.repoName }).from(projects).where(eq(projects.repoId, repoId));
  if (!known) return;
  const knownAs = `${known.repoOwner}/${known.repoName}`;
  if (knownAs.toLowerCase() === repo.toLowerCase()) throw new Error(`${repo} is already a project: ${known.name}.`);
  throw new Error(
    `${repo} is the project ${known.name}, which knows it as ${knownAs}. It moved: run handoff project move ${known.name} --repo ${repo}, or use Settings, Projects, Repository moved.`,
  );
}

/**
 * Adds a project; with a GitHub client it also checks the repository exists and stores its id, and refuses a
 * repository a project has already, also under the name it had before GitHub moved it.
 * Without a name the project is named after the repository (lowercase, dashes, made unique).
 */
export async function createProject(db: Db, input: { name?: string; repo: string; defaultBranch: string }, github?: GitHubPort) {
  const [owner, name, extra] = input.repo.trim().split("/");
  if (!owner || !name || extra !== undefined) throw new Error("Repository must look like owner/name.");
  const projectName = input.name?.trim() || suggestProjectName(name, (await db.select({ name: projects.name }).from(projects)).map((p) => p.name));
  if (!/^[a-z0-9][a-z0-9-]*$/.test(projectName)) throw new Error("Project name: lowercase letters, digits and dashes.");
  let repoId: number | null = null;
  if (github) {
    try {
      repoId = await github.getRepoId({ owner, name });
    } catch {
      throw new Error(`GitHub cannot find ${owner}/${name} with the configured credentials.`);
    }
    await refuseKnownRepository(db, `${owner}/${name}`, repoId);
  }
  const [project] = await db
    .insert(projects)
    .values({ name: projectName, repoOwner: owner, repoName: name, defaultBranch: input.defaultBranch || "main", repoId })
    .returning();
  return project!;
}

export async function getProjectDetail(db: Db, projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return undefined;
  const [graphRows, runRows, [lastUsed]] = await Promise.all([
    db.select().from(graphs).where(eq(graphs.projectId, projectId)).orderBy(graphs.name),
    db.select().from(runs).where(eq(runs.projectId, projectId)).orderBy(desc(runs.createdAt)).limit(50),
    db
      .select({ name: graphs.name })
      .from(runs)
      .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
      .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
      .where(eq(runs.projectId, projectId))
      .orderBy(desc(runs.createdAt))
      .limit(1),
  ]);
  // New runs default to the graph the latest run used; without runs, to the graph changed last.
  const lastChanged = [...graphRows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  return { project, graphs: graphRows, runs: runRows, defaultGraph: lastUsed?.name ?? lastChanged?.name };
}

/** The project's graphs by name, each with its latest version, when it was last saved and how many runs used any version of it. */
export async function listProjectGraphs(db: Db, projectId: string) {
  return db
    .select({
      id: graphs.id,
      name: graphs.name,
      latestVersion: graphs.latestVersion,
      savedAt: graphs.updatedAt,
      runs: sql<number>`(select count(*)::int from runs r join graph_versions v on v.id = r.graph_version_id where v.graph_id = "graphs"."id")`,
    })
    .from(graphs)
    .where(eq(graphs.projectId, projectId))
    .orderBy(graphs.name);
}

/** The graph version the editor opens: the one asked for, such as a run's pinned version, or else the latest. */
export async function getGraphForEdit(db: Db, projectId: string, name: string, version?: number) {
  const [row] = await db
    .select({ version: graphVersions.version, document: graphVersions.document, versionId: graphVersions.id })
    .from(graphVersions)
    .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
    .where(and(eq(graphs.projectId, projectId), eq(graphs.name, name), version === undefined ? undefined : eq(graphVersions.version, version)))
    .orderBy(desc(graphVersions.version))
    .limit(1);
  return row;
}

export async function listGraphVersions(db: Db, projectId: string, name: string) {
  return db
    .select({ version: graphVersions.version, createdAt: graphVersions.createdAt, createdBy: graphVersions.createdBy })
    .from(graphVersions)
    .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
    .where(and(eq(graphs.projectId, projectId), eq(graphs.name, name)))
    .orderBy(desc(graphVersions.version));
}

export async function getGraphVersion(db: Db, projectId: string, name: string, version: number) {
  const [row] = await db
    .select({ version: graphVersions.version, document: graphVersions.document })
    .from(graphVersions)
    .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
    .where(and(eq(graphs.projectId, projectId), eq(graphs.name, name), eq(graphVersions.version, version)));
  return row;
}

export type SaveResult = { ok: true; version: number } | { ok: false; errors: CompileError[] };

/** Validates with validateGraphForSave and stores a new immutable version; runs stay pinned to theirs. */
export async function saveGraphVersion(db: Db, input: { projectId: string; name: string; document: unknown; createdBy?: string }): Promise<SaveResult> {
  const compiled = validateGraphForSave(input.document);
  if (!compiled.ok) return { ok: false, errors: compiled.errors };
  const version = await db.transaction(async (tx) => {
    const [graph] = await tx
      .insert(graphs)
      .values({ projectId: input.projectId, name: input.name, latestVersion: 1 })
      .onConflictDoUpdate({ target: [graphs.projectId, graphs.name], set: { latestVersion: sql`${graphs.latestVersion} + 1` } })
      .returning();
    await tx.insert(graphVersions).values({
      graphId: graph!.id,
      version: graph!.latestVersion,
      document: compiled.graph.document as unknown as Record<string, unknown>,
      createdBy: input.createdBy ?? "dashboard",
    });
    return graph!.latestVersion;
  });
  return { ok: true, version };
}

/** New graphs start from a template; the empty template is stored without compiling so it can be edited. */
export async function createGraphFromTemplate(db: Db, projectId: string, name: string, template: TemplateName) {
  if (template !== "empty") return saveGraphVersion(db, { projectId, name, document: TEMPLATES[template].document });
  const [graph] = await db.insert(graphs).values({ projectId, name, latestVersion: 1 }).returning();
  await db.insert(graphVersions).values({ graphId: graph!.id, version: 1, document: TEMPLATES.empty.document as Record<string, unknown>, createdBy: "dashboard" });
  return { ok: true as const, version: 1 };
}

/** Starts a run of a graph's latest version through the engine's shared start, the one the scheduler uses too. */
export async function startRunFromGraph(db: Db, input: StartRunInput, github?: GitHubPort, plan?: ProjectsPort) {
  return startRun(db, input, { github, projects: plan });
}

/** Where a run started again begins: on the earlier run's branch, or on the default branch with only the task. */
export type RunAgainFrom = "branch" | "scratch";

export type RunAgainOptions = {
  github?: GitHubPort | undefined;
  projects?: ProjectsPort | undefined;
  startedBy?: string | undefined;
  /** Defaults to the branch when the earlier run's branch has work of its own, else scratch. */
  from?: RunAgainFrom | undefined;
};

/**
 * Starts the same task again on the latest version of the graph an earlier run used, after the same
 * blocker check as any start. From the branch, the new branch starts at the earlier run's branch and its
 * planner is told the earlier plan, decisions and open findings. The earlier run is marked superseded and,
 * when it failed, cancelled. With the Projects port its tasks move to Running on the plan, as for any new
 * run, without the Ready gate.
 */
export async function runAgain(db: Db, runId: string, opts: RunAgainOptions = {}) {
  const [earlier] = await db
    .select({
      id: runs.id,
      projectId: runs.projectId,
      task: runs.task,
      status: runs.status,
      state: runs.state,
      size: runs.size,
      branchName: runs.branchName,
      supersededBy: runs.supersededBy,
      graphName: graphs.name,
    })
    .from(runs)
    .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
    .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
    .where(eq(runs.id, runId));
  if (!earlier) throw new Error("run not found");
  if (earlier.status === "queued" || earlier.status === "running" || earlier.status === "waiting") {
    throw new Error(`The run is still ${earlier.status}.`);
  }
  if (earlier.supersededBy) throw new Error(`The run was run again as ${earlier.supersededBy}. Run that one again instead.`);
  const issues = RunStateSchema.shape.issues.parse(earlier.state.issues) ?? [];
  const from = opts.from ?? (branchHasWork(earlier) ? "branch" : "scratch");
  const previousRun = from === "branch" ? previousRunOf(earlier) : undefined;
  // The earlier run's task is part 1 of a split: the new run builds that part too, and its pull request does not close the split issue.
  const splitOf = await splitOfRun(db, { id: earlier.id, issues, state: earlier.state });
  const again = await startRunFromGraph(
    db,
    {
      projectId: earlier.projectId,
      graphName: earlier.graphName,
      task: earlier.task,
      issues,
      again: true,
      size: earlier.size,
      startedBy: opts.startedBy,
      previousRun,
      splitOf,
      statusesBefore: await statusesBeforeRun(db, runId),
    },
    opts.github,
    opts.projects,
  );
  // The new run takes the old one's place: the old run leaves what needs attention, and a failed one is
  // cancelled, which frees its worktree. Its tasks stay with the new run.
  await db.update(runs).set({ supersededBy: again.id }).where(eq(runs.id, runId));
  if (earlier.status === "failed") await cancelRun(db, runId, { reason: `run again as ${again.id}`, projects: opts.projects });
  return again;
}

/** What accepting a split needs: the database, GitHub for plain issues, and the plan for sub-issues. */
export type SplitDeps = { db: Db; github: GitHubPort | undefined; projects: ProjectsPort | undefined };

/**
 * In a Flow project, moves a split's later parts right after the run's task in Project order, in part order, so
 * they come next in the queue instead of last. Does nothing when the task is not an item of the Project.
 */
async function partsAfterTask(plan: ProjectsPort, repo: { owner: string; name: string }, number: number, task: number, parts: SplitIssue[]) {
  const idOf = new Map((await plan.listItems(repo.owner, number, repo)).map((item) => [item.number, item.itemId]));
  const ids = [task, ...parts.map((p) => p.number)].map((n) => idOf.get(n));
  if (ids.some((id) => id === undefined)) return;
  await plan.moveItems(
    repo.owner,
    number,
    ids.slice(1).map((itemId, index) => ({ itemId: itemId!, afterId: ids[index]! })),
  );
}

/**
 * Where a split's parts go in the plan: under the parent of the run's issue (its story), or under no issue
 * when it has none, labelled `task` with the run's issue's labels other than the kind labels.
 */
async function placeOfParts(deps: SplitDeps, repo: { owner: string; name: string }, issue: number): Promise<{ labels: string[]; parent?: number | undefined }> {
  const [[parent], labels] = await Promise.all([deps.projects!.lineage(repo, issue), deps.github ? deps.github.getIssue(repo, issue).then((i) => i.labels) : []]);
  const kinds = new Set<string>(PLAN_KINDS);
  return { labels: ["task", ...labels.filter((l) => !kinds.has(l.toLowerCase()))], parent: parent?.number };
}

/**
 * "Split as proposed" at a plan gate: opens one issue for each part after the first, then narrows the
 * run to the first part and answers the gate, which sends the planner back to plan that part. Each issue
 * is blocked by the one before it (the first by the run's issue) through GitHub's blocked-by link, so the
 * parts run in order. With a plan on GitHub Projects each issue is a task with the run's issue's other
 * labels, and a sub-issue of the run's issue's parent, or of no issue when that has none. Without a plan
 * each issue also names the one before it in a "Depends on" line. In a Flow project the parts land right
 * after the run's task in Project order. When a later part repeats another issue of the run, splitRun
 * drops that issue from the run. Returns the opened issues.
 */
export async function splitPlan(deps: SplitDeps, input: { runId: string; questionId: string; answeredBy: string; note?: string | undefined }): Promise<SplitIssue[]> {
  const [row] = await deps.db
    .select({ question: questions, issues: runs.issues, task: runs.task, owner: projects.repoOwner, name: projects.repoName, planNumber: projects.planProjectNumber, planMode: projects.planMode })
    .from(questions)
    .innerJoin(runs, eq(runs.id, questions.runId))
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .where(and(eq(questions.id, input.questionId), eq(questions.runId, input.runId)));
  if (!row) throw new Error("Question not found.");
  if (row.question.answer !== null) throw new Error("question already answered");
  const parts = splitPartsOf(row.question.context);
  if (!parts) throw new Error("This question does not offer a split.");
  const repo = { owner: row.owner, name: row.name };
  const parent = row.issues[0];
  const origin = parent ? `#${parent.number}` : `"${row.task.split("\n")[0]!.trim()}"`;
  const withPlan = row.planNumber !== null && deps.projects !== undefined;
  if (!withPlan && !deps.github) throw new Error("handoff has no GitHub credentials to open the parts' issues with.");

  const placed = withPlan && parent ? await placeOfParts(deps, repo, parent.number) : { labels: ["task"] };
  const opened: SplitIssue[] = [];
  for (const [index, part] of parts.entries()) {
    if (index === 0) continue;
    const about = `Part ${index + 1} of ${parts.length} of ${origin}, split by handoff's planner. The plan expects it to change ${part.ownedPaths.map((p) => `\`${p}\``).join(", ")}.`;
    const before = opened.at(-1)?.number ?? parent?.number;
    let created: { number: number; url: string };
    if (withPlan) {
      created = await deps.projects!.createIssue(repo, {
        project: row.planNumber!,
        title: part.title,
        body: `${part.body.trim()}\n\n${about}`,
        labels: placed.labels,
        ...(placed.parent !== undefined ? { parent: placed.parent } : {}),
        ...(before ? { blockedBy: [before] } : {}),
      });
    } else {
      created = await deps.github!.createIssue(repo, { title: part.title, body: [part.body.trim(), about, ...(before ? [`Depends on: #${before}`] : [])].join("\n\n") });
      if (before) await deps.github!.addBlockedBy(repo, created.number, before);
    }
    opened.push({ number: created.number, title: part.title, url: created.url });
  }
  if (withPlan && row.planMode === "flow" && parent && opened.length) await partsAfterTask(deps.projects!, repo, row.planNumber!, parent.number, opened);
  await splitRun(deps.db, input.questionId, { answeredBy: input.answeredBy, issues: opened, note: input.note });
  return opened;
}

const GRAPH_NAME = /^[a-z0-9][a-z0-9-]*$/;

export async function renameGraph(db: Db, projectId: string, from: string, to: string) {
  if (!GRAPH_NAME.test(to)) throw new Error("Graph name: lowercase letters, digits and dashes.");
  const [taken] = await db.select({ id: graphs.id }).from(graphs).where(and(eq(graphs.projectId, projectId), eq(graphs.name, to)));
  if (taken) throw new Error(`A graph named ${to} already exists.`);
  await db.update(graphs).set({ name: to }).where(and(eq(graphs.projectId, projectId), eq(graphs.name, from)));
}

/** Deletes a graph and its versions; refused while any run is pinned to one of its versions. */
export async function deleteGraph(db: Db, projectId: string, name: string) {
  await db.transaction(async (tx) => {
    const [graph] = await tx.select({ id: graphs.id }).from(graphs).where(and(eq(graphs.projectId, projectId), eq(graphs.name, name)));
    if (!graph) return;
    const versionIds = (await tx.select({ id: graphVersions.id }).from(graphVersions).where(eq(graphVersions.graphId, graph.id))).map((v) => v.id);
    if (versionIds.length) {
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(runs).where(inArray(runs.graphVersionId, versionIds));
      if (n > 0) throw new Error(`${n} run${n === 1 ? "" : "s"} used this graph, so it cannot be deleted. Rename it instead.`);
      await tx.delete(graphVersions).where(eq(graphVersions.graphId, graph.id));
    }
    await tx.delete(graphs).where(eq(graphs.id, graph.id));
  });
}
