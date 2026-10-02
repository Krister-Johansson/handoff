import { eq, projects, type Db } from "@handoff/db";
import { STATUS_OPTIONS, type GitHubPort, type PlanKind, type PlanProject, type PlanStatus, type ProjectsPort } from "@handoff/github";
import { latestRuns } from "./backlog.ts";
import { projectsAccessProblem } from "./plan.ts";

/**
 * Shaping a project's plan on GitHub Projects: setting the plan up, creating epics, stories and tasks,
 * and moving tasks between Shaping and Ready. Each function is one of the catalog's confirm tools, so a
 * person approves every write to GitHub before it runs. Every function refuses with the sentence that
 * says what is missing when handoff cannot write Projects.
 */

/** What shaping needs: the database, GitHub for issue bodies, and the plan on GitHub Projects. */
export type ShapingDeps = { db: Db; github: GitHubPort | undefined; projects: ProjectsPort | undefined };

/** The handoff project with a Projects port that can write, or the sentence that says what is missing. */
async function shapingAccess(deps: ShapingDeps, projectId: string) {
  const [project] = await deps.db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("Project not found.");
  const problem = await projectsAccessProblem(deps.projects);
  if (problem || !deps.projects) throw new Error(problem);
  return { project, plan: deps.projects, repo: { owner: project.repoOwner, name: project.repoName } };
}

/** shapingAccess for a project that has a plan: its GitHub Project's number with it. */
async function plannedProject(deps: ShapingDeps, projectId: string) {
  const access = await shapingAccess(deps, projectId);
  const number = access.project.planProjectNumber;
  if (number === null) throw new Error(`${access.project.name} has no plan on GitHub yet. Set one up with setup_plan first.`);
  return { ...access, number };
}

type Planned = Awaited<ReturnType<typeof plannedProject>>;

const missingOptions = (project: PlanProject) => STATUS_OPTIONS.filter((s) => !project.statusOptions[s]);
const projectSummary = ({ number, title, url }: PlanProject) => ({ number, title, url });

/** The user's GitHub Projects setup can use, those linked to the project's repository first. */
export async function listGitHubProjects(deps: ShapingDeps, projectId: string) {
  const { plan, repo } = await shapingAccess(deps, projectId);
  return (await plan.listProjects(repo.owner, repo)).map((p) => ({ number: p.number, title: p.title, url: p.url, linked: p.linked, missing_status_options: p.missingStatusOptions }));
}

/**
 * Sets up a project's plan: the kind labels on the repository and a user-owned GitHub Project with
 * handoff's Status options, linked to the repository, whose number the project stores. `use` adopts an
 * existing Project of the user instead of creating one. With a number already stored it creates
 * nothing: it re-creates missing labels and reports Status options the Project lacks.
 */
export async function setupPlan(deps: ShapingDeps, projectId: string, opts: { use?: number } = {}) {
  const { project, plan, repo } = await shapingAccess(deps, projectId);
  const stored = project.planProjectNumber;
  if (stored !== null && opts.use !== undefined && opts.use !== stored) {
    throw new Error(`${project.name} already has a plan: GitHub Project #${stored}. handoff keeps one Project per project.`);
  }
  await plan.ensureLabels(repo);
  const store = (number: number) => deps.db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));

  if (stored !== null) {
    const found = await plan.getProject(repo.owner, stored);
    if (!found) throw new Error(`GitHub Project #${stored} of ${repo.owner} does not exist or GITHUB_TOKEN cannot see it.`);
    return { created: false, project: projectSummary(found), missing_status_options: missingOptions(found) };
  }
  if (opts.use !== undefined) {
    const adopted = await plan.adoptProject(repo.owner, opts.use, repo);
    await store(adopted.project.number);
    return {
      created: false,
      project: projectSummary(adopted.project),
      renamed_status_options: adopted.renamed,
      added_status_options: adopted.added,
      missing_status_options: missingOptions(adopted.project),
    };
  }
  const created = await plan.createProject(repo.owner, repo, `${project.name} plan`);
  await store(created.number);
  return { created: true, project: projectSummary(created), missing_status_options: missingOptions(created) };
}

const article = (kind: PlanKind | undefined) => (kind === "epic" ? "an epic" : kind ? `a ${kind}` : "an issue without a kind label");
const checkboxes = (items: readonly string[]) => items.map((item) => `- [ ] ${item.trim()}`).join("\n");

/** The plan's item `issue`, which must be of `kind`; refuses an issue outside the plan or of another kind. */
async function parentOf({ plan, repo, number, project }: Planned, issue: number, kind: PlanKind) {
  const item = (await plan.listItems(repo.owner, number, repo)).find((i) => i.number === issue);
  if (!item) throw new Error(`#${issue} is not in the plan of ${project.name}. Add it with plan_issue, or pick another ${kind}.`);
  if (item.kind !== kind) throw new Error(`#${issue} is ${article(item.kind)}, not ${article(kind)}.`);
  return item;
}

/** An epic: an issue labelled epic with its goal, in Shaping on the plan. */
export async function createEpic(deps: ShapingDeps, projectId: string, input: { title: string; goal: string }) {
  const { plan, repo, number } = await plannedProject(deps, projectId);
  const created = await plan.createIssue(repo, { project: number, title: input.title, body: `## Goal\n\n${input.goal.trim()}`, labels: ["epic"] });
  return { ...created, kind: "epic" as const, status: "Shaping" as const };
}

/** A story: a sub-issue of an epic labelled story, its acceptance criteria as checkboxes, in Shaping. */
export async function createStory(deps: ShapingDeps, projectId: string, input: { epic: number; title: string; acceptance: string[] }) {
  const planned = await plannedProject(deps, projectId);
  await parentOf(planned, input.epic, "epic");
  const body = `## Acceptance criteria\n\n${checkboxes(input.acceptance)}`;
  const created = await planned.plan.createIssue(planned.repo, { project: planned.number, title: input.title, body, labels: ["story"], parent: input.epic });
  return { ...created, kind: "story" as const, status: "Shaping" as const, parent: input.epic };
}

/**
 * A task: a sub-issue of a story labelled task, whose body is its brief and optional acceptance
 * criteria, blocked by the given issues, in Shaping. Tasks are the third and last level.
 */
export async function createTask(deps: ShapingDeps, projectId: string, input: { story: number; title: string; brief: string; acceptance?: string[]; blockedBy?: number[] }) {
  const planned = await plannedProject(deps, projectId);
  await parentOf(planned, input.story, "story");
  const criteria = input.acceptance?.length ? `\n\n## Acceptance criteria\n\n${checkboxes(input.acceptance)}` : "";
  const blockedBy = input.blockedBy ?? [];
  const created = await planned.plan.createIssue(planned.repo, {
    project: planned.number,
    title: input.title,
    body: `${input.brief.trim()}${criteria}`,
    labels: ["task"],
    parent: input.story,
    blockedBy,
  });
  return { ...created, kind: "task" as const, status: "Shaping" as const, parent: input.story, blocked_by: blockedBy };
}

/**
 * Brings an open issue outside the plan into it as a task in Shaping: the task label, and a sub-issue
 * of `story` when given. The issue is one of the project's repository, as sub-issues need the same owner.
 */
export async function planIssue(deps: ShapingDeps, projectId: string, input: { issue: number; story?: number }) {
  const planned = await plannedProject(deps, projectId);
  const items = await planned.plan.listItems(planned.repo.owner, planned.number, planned.repo);
  if (items.some((i) => i.number === input.issue)) throw new Error(`#${input.issue} is already in the plan of ${planned.project.name}.`);
  if (input.story !== undefined) await parentOf(planned, input.story, "story");
  await planned.plan.addIssue(planned.repo, { project: planned.number, issue: input.issue, labels: ["task"], ...(input.story !== undefined ? { parent: input.story } : {}) });
  return { number: input.issue, kind: "task" as const, status: "Shaping" as const, parent: input.story ?? null };
}

/** The plan's tasks among `issues`, refusing the whole call for an issue outside the plan or one that is not a task. */
async function tasksOf({ plan, repo, number, project }: Planned, issues: number[]) {
  const items = new Map((await plan.listItems(repo.owner, number, repo)).map((i) => [i.number, i]));
  return issues.map((issue) => {
    const item = items.get(issue);
    if (!item) throw new Error(`#${issue} is not in the plan of ${project.name}. Add it with plan_issue first.`);
    if (item.kind !== "task") throw new Error(`#${issue} is ${article(item.kind)}. Only tasks move between Shaping and Ready; runs work on tasks.`);
    if (item.state === "closed") throw new Error(`#${issue} is closed. Reopen it on GitHub first.`);
    return item;
  });
}

async function setStatuses({ plan, repo, number }: Planned, issues: number[], status: PlanStatus) {
  const results = await Promise.all(issues.map(async (issue) => ({ issue, result: await plan.setStatus(repo, number, issue, status) })));
  const failed = results.find((r) => r.result !== "set");
  if (failed) {
    throw new Error(`#${failed.issue} could not move to ${status}: ${failed.result === "no-option" ? `the Project has no ${status} option; run setup_plan` : "it is not in the Project"}.`);
  }
}

/**
 * Moves shaped tasks to Ready, which lets them into the backlog. Refuses the whole call for an epic,
 * a story, a closed issue, a task without a body (the agents would have nothing to read) or an issue
 * outside the plan.
 */
export async function moveToReady(deps: ShapingDeps, projectId: string, issues: number[]) {
  const planned = await plannedProject(deps, projectId);
  const { github } = deps;
  if (!github) throw new Error("Moving tasks to Ready needs GitHub access to read their bodies (GITHUB_TOKEN or a GitHub App).");
  const tasks = await tasksOf(planned, issues);
  const bodies = await Promise.all(tasks.map(async (task) => ({ issue: task.number, body: (await github.getIssue(planned.repo, task.number)).body })));
  const empty = bodies.find((b) => !b.body.trim());
  if (empty) throw new Error(`#${empty.issue} has no body. Write its brief first: the agents read it.`);
  await setStatuses(planned, issues, "Ready");
  return { moved: issues, status: "Ready" as const };
}

const ACTIVE = new Set(["queued", "running", "waiting"]);

/**
 * Moves tasks back to Shaping, out of the backlog. Refuses the whole call for a task an active run
 * works on (the run owns its status), a closed issue, or an issue that is not a task of the plan.
 */
export async function moveToShaping(deps: ShapingDeps, projectId: string, issues: number[]) {
  const planned = await plannedProject(deps, projectId);
  const [tasks, runs] = await Promise.all([tasksOf(planned, issues), latestRuns(deps.db, planned.project.id)]);
  for (const task of tasks) {
    const run = runs.get(task.number);
    if (run && ACTIVE.has(run.status)) throw new Error(`#${task.number} has an active run (${run.id}, ${run.status}). Cancel the run first; a running task keeps its status.`);
  }
  await setStatuses(planned, issues, "Shaping");
  return { moved: issues, status: "Shaping" as const };
}
