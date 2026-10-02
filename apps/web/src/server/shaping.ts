import { eq, projects, type Db } from "@handoff/db";
import {
  PLAN_SIZES,
  STATUS_OPTIONS,
  type GitHubPort,
  type PlanFields,
  type PlanItem,
  type PlanKind,
  type PlanProject,
  type PlanSize,
  type PlanStatus,
  type ProjectsPort,
} from "@handoff/github";
import { nudgeScheduler } from "@handoff/engine/backlog-scheduler";
import { recordPlanStatus } from "@handoff/engine/plan-status";
import { durationOf } from "../lib/plan/forecast.ts";
import { sizedBars } from "../lib/plan/schedule.ts";
import { latestRuns, type BacklogRun } from "./backlog.ts";
import { latestProposals, loadForecasts, type Proposal } from "./forecasts.ts";
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
 * nothing: it re-creates missing labels and reports Status options the Project lacks. An adopted or
 * stored Project's items that active runs work on get the Status each run owns (statuses_from_runs).
 */
export async function setupPlan(deps: ShapingDeps, projectId: string, opts: { use?: number } = {}) {
  const { project, plan, repo } = await shapingAccess(deps, projectId);
  const stored = project.planProjectNumber;
  if (stored !== null && opts.use !== undefined && opts.use !== stored) {
    throw new Error(`${project.name} already has a plan: GitHub Project #${stored}. handoff keeps one Project per project.`);
  }
  await plan.ensureLabels(repo);
  const store = (number: number) => deps.db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, project.id));

  // The Start and Target date fields a Project lacks, created; the roadmap layout reads them once a person picks them.
  // Size and Estimate likewise, with S, M and L added to a Size field that lacks them.
  const dateFields = async (found: PlanProject) => {
    const missing = DATE_FIELDS.filter(([key]) => !found.dateFields?.[key]).map(([, name]) => name);
    if (missing.length) await plan.ensureDateFields(repo.owner, found.number);
    const missingEstimate = missingEstimateFields(found);
    if (missingEstimate.length) await plan.ensureEstimateFields(repo.owner, found.number);
    return { added_date_fields: missing, added_estimate_fields: missingEstimate, roadmap: ROADMAP_NOTE };
  };

  if (stored !== null) {
    const found = await plan.getProject(repo.owner, stored);
    if (!found) throw new Error(`GitHub Project #${stored} of ${repo.owner} does not exist or GITHUB_TOKEN cannot see it.`);
    const fromRuns = await statusesFromRuns(deps.db, { plan, project, repo, number: stored });
    return { created: false, project: projectSummary(found), missing_status_options: missingOptions(found), statuses_from_runs: fromRuns, ...(await dateFields(found)) };
  }
  if (opts.use !== undefined) {
    const adopted = await plan.adoptProject(repo.owner, opts.use, repo);
    await store(adopted.project.number);
    const fromRuns = await statusesFromRuns(deps.db, { plan, project, repo, number: adopted.project.number });
    return {
      created: false,
      project: projectSummary(adopted.project),
      renamed_status_options: adopted.renamed,
      added_status_options: adopted.added,
      missing_status_options: missingOptions(adopted.project),
      statuses_from_runs: fromRuns,
      ...(await dateFields(adopted.project)),
    };
  }
  const created = await plan.createProject(repo.owner, repo, `${project.name} plan`);
  await store(created.number);
  // A new Project has no items yet, so no run's Status to write.
  return { created: true, project: projectSummary(created), missing_status_options: missingOptions(created), statuses_from_runs: [], ...(await dateFields(created)) };
}

const DATE_FIELDS = [
  ["start", "Start"],
  ["target", "Target"],
] as const;
const ROADMAP_NOTE =
  'GitHub cannot be told which fields a roadmap view uses: in a Roadmap view of the Project, open "Date fields" and pick Start and Target once.';

const article = (kind: PlanKind | undefined) => (kind === "epic" ? "an epic" : kind ? `a ${kind}` : "an issue without a kind label");
const checkboxes = (items: readonly string[]) => items.map((item) => `- [ ] ${item.trim()}`).join("\n");

/** The plan's item `issue`, which must be of `kind`; refuses an issue outside the plan or of another kind. */
async function parentOf({ plan, repo, number, project }: Planned, issue: number, kind: PlanKind) {
  const item = (await plan.listItems(repo.owner, number, repo)).find((i) => i.number === issue);
  if (!item) throw new Error(`#${issue} is not in the plan of ${project.name}. Add it with plan_issue, or pick another ${kind}.`);
  if (item.kind !== kind) throw new Error(`#${issue} is ${article(item.kind)}, not ${article(kind)}.`);
  return item;
}

/** The Start and Target a new story or task may get, YYYY-MM-DD. */
type NewDates = { start?: string | undefined; target?: string | undefined };

/** The dates given, without the keys left out. */
const datesOf = ({ start, target }: NewDates) => ({ ...(start ? { start } : {}), ...(target ? { target } : {}) });

/** Refuses new dates before the issue is created: a malformed date, a Target before its Start, a Project without the date fields. */
async function checkNewDates(planned: Planned, dates: NewDates) {
  if (!dates.start && !dates.target) return;
  checkDates("The new issue", dates.start, dates.target);
  await requireDateFields(planned);
}

/** An epic: an issue labelled epic with its goal, in Shaping on the plan. */
export async function createEpic(deps: ShapingDeps, projectId: string, input: { title: string; goal: string }) {
  const { plan, repo, number } = await plannedProject(deps, projectId);
  const created = await plan.createIssue(repo, { project: number, title: input.title, body: `## Goal\n\n${input.goal.trim()}`, labels: ["epic"] });
  return { ...created, kind: "epic" as const, status: "Shaping" as const };
}

/** A story: a sub-issue of an epic labelled story, its acceptance criteria as checkboxes, in Shaping. */
export async function createStory(deps: ShapingDeps, projectId: string, input: { epic: number; title: string; acceptance: string[] } & NewDates) {
  const planned = await plannedProject(deps, projectId);
  await Promise.all([parentOf(planned, input.epic, "epic"), checkNewDates(planned, input)]);
  const body = `## Acceptance criteria\n\n${checkboxes(input.acceptance)}`;
  const created = await planned.plan.createIssue(planned.repo, { project: planned.number, title: input.title, body, labels: ["story"], parent: input.epic, ...datesOf(input) });
  return { ...created, kind: "story" as const, status: "Shaping" as const, parent: input.epic, ...datesOf(input) };
}

/**
 * A task: a sub-issue of a story labelled task, whose body is its brief and optional acceptance
 * criteria, blocked by the given issues, in Shaping. Tasks are the third and last level.
 */
export async function createTask(
  deps: ShapingDeps,
  projectId: string,
  input: { story: number; title: string; brief: string; acceptance?: string[]; blockedBy?: number[] } & NewDates,
) {
  const planned = await plannedProject(deps, projectId);
  await Promise.all([parentOf(planned, input.story, "story"), checkNewDates(planned, input)]);
  const criteria = input.acceptance?.length ? `\n\n## Acceptance criteria\n\n${checkboxes(input.acceptance)}` : "";
  const blockedBy = input.blockedBy ?? [];
  const created = await planned.plan.createIssue(planned.repo, {
    project: planned.number,
    title: input.title,
    body: `${input.brief.trim()}${criteria}`,
    labels: ["task"],
    parent: input.story,
    blockedBy,
    ...datesOf(input),
  });
  return { ...created, kind: "task" as const, status: "Shaping" as const, parent: input.story, blocked_by: blockedBy, ...datesOf(input) };
}

/**
 * Brings an open issue outside the plan into it as a task: the task label, and a sub-issue of `story`
 * when given. It lands in Shaping, or in the Status its active run owns, written as the run's own
 * write. The issue is one of the project's repository, as sub-issues need the same owner.
 */
export async function planIssue(deps: ShapingDeps, projectId: string, input: { issue: number; story?: number }) {
  const planned = await plannedProject(deps, projectId);
  const [items, runs] = await Promise.all([planned.plan.listItems(planned.repo.owner, planned.number, planned.repo), latestRuns(deps.db, planned.project.id)]);
  if (items.some((i) => i.number === input.issue)) throw new Error(`#${input.issue} is already in the plan of ${planned.project.name}.`);
  if (input.story !== undefined) await parentOf(planned, input.story, "story");
  await planned.plan.addIssue(planned.repo, { project: planned.number, issue: input.issue, labels: ["task"], ...(input.story !== undefined ? { parent: input.story } : {}) });
  const run = runs.get(input.issue);
  // The issue joined the plan in Shaping, the Status a cancel of its run puts back.
  const status = run ? await statusFromRun(deps.db, planned, run, input.issue, "Shaping") : undefined;
  return { number: input.issue, kind: "task" as const, status: status ?? ("Shaping" as const), parent: input.story ?? null };
}

/**
 * Sets an item of the plan that `run` works on to the Status the run owns, recorded on the run as the
 * run's own writes are, with the Status the item had (`from`) for a cancel of the run to put back.
 * Returns the Status written; undefined for a run that ended or a skipped write.
 */
async function statusFromRun(
  db: Db,
  { plan, project, number }: Pick<Planned, "plan" | "project" | "number">,
  run: BacklogRun,
  issue: number,
  from: PlanStatus | undefined,
) {
  const owned = ownedStatus(run);
  if (!owned) return undefined;
  const [event] = await recordPlanStatus(db, run.id, plan, { ...project, planProjectNumber: number }, [issue], owned, new Map([[issue, from]]));
  return event?.type === "plan.status" ? owned : undefined;
}

/**
 * Brings the open items of a plan's Project that active runs work on to the Status each run owns,
 * as when the items join the plan. Items that agree already, and items without an active run, keep
 * their Status. Returns the items it set.
 */
async function statusesFromRuns(db: Db, planned: Pick<Planned, "plan" | "project" | "number" | "repo">) {
  const [items, runs] = await Promise.all([planned.plan.listItems(planned.repo.owner, planned.number, planned.repo), latestRuns(db, planned.project.id)]);
  const set = await Promise.all(
    items.map(async (item) => {
      const run = runs.get(item.number);
      if (!run || item.state === "closed" || item.status === ownedStatus(run)) return [];
      const status = await statusFromRun(db, planned, run, item.number, item.status);
      return status ? [{ issue: item.number, status, run: run.id }] : [];
    }),
  );
  return set.flat().sort((a, b) => a.issue - b.issue);
}

/** Run statuses in which a run still owns its tasks. */
const ACTIVE = new Set(["queued", "running", "waiting"]);

/**
 * The Status an active run owns for its tasks, as the run's own writes set it: In review once the run
 * recorded its pull request, else Running. Undefined for a run that ended.
 */
function ownedStatus(run: BacklogRun): PlanStatus | undefined {
  if (!ACTIVE.has(run.status)) return undefined;
  return run.prNumber === null ? "Running" : "In review";
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
  await nudgeScheduler(deps.db, projectId);
  return { moved: issues, status: "Ready" as const };
}

/** One item of a schedule call: a date sets the field, null clears it, a missing key leaves it. */
export type ScheduleItem = { issue: number; start?: string | null; target?: string | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day written YYYY-MM-DD. */
const isDay = (value: string) => {
  const at = Date.parse(`${value}T00:00:00Z`);
  // Date rolls 2026-02-31 over to March, so the day must read back the same.
  return DAY.test(value) && !Number.isNaN(at) && new Date(at).toISOString().startsWith(value);
};

/** Refuses a date that is not a day written YYYY-MM-DD, and a Target before its Start. */
function checkDates(label: string, start: string | null | undefined, target: string | null | undefined) {
  for (const [name, value] of [["Start", start], ["Target", target]] as const) {
    if (value && !isDay(value)) throw new Error(`${label}: ${name} ${value} is not a date written YYYY-MM-DD.`);
  }
  if (start && target && target < start) throw new Error(`${label}: Target ${target} is before its Start ${start}.`);
}

/** Refuses before any write when the plan's Project lacks the Start or Target date field. */
async function requireDateFields({ plan, repo, number }: Planned) {
  const found = await plan.getProject(repo.owner, number);
  if (!found?.dateFields?.start || !found.dateFields.target) {
    throw new Error(`GitHub Project #${number} has no Start and Target date fields. Run setup_plan to add them, then schedule again.`);
  }
}

const shown = (date: string | null | undefined) => date ?? "none";

/** Gives the plan's Project its Start and Target date fields when it lacks them, as the timeline's banner asks. */
export async function addDateFields(deps: ShapingDeps, projectId: string) {
  const { plan, repo, number } = await plannedProject(deps, projectId);
  return { date_fields: await plan.ensureDateFields(repo.owner, number), roadmap: ROADMAP_NOTE };
}

/** The Size and Estimate fields a Project lacks: a Size field without S, M or L counts as missing. */
function missingEstimateFields(project: PlanProject): ("Size" | "Estimate")[] {
  const fields = project.estimateFields;
  const size = fields?.size && PLAN_SIZES.every((s) => fields.size?.options[s]);
  return [...(size ? [] : (["Size"] as const)), ...(fields?.estimate ? [] : (["Estimate"] as const))];
}

/** Gives the plan's Project its Size and Estimate fields when it lacks them, as the timeline's banner asks. */
export async function addEstimateFields(deps: ShapingDeps, projectId: string) {
  const { plan, repo, number } = await plannedProject(deps, projectId);
  return { estimate_fields: await plan.ensureEstimateFields(repo.owner, number) };
}

/** The most hours a manual estimate may hold. */
const MAX_ESTIMATE = 1000;

/** One change of a task's size: a value sets Size or Estimate (hours; 0 clears it), null clears it, a missing key leaves it. */
export type SizeInput = { issue: number; size?: PlanSize | null; estimate?: number | null };

/**
 * Sets or clears a task's Size and its manual estimate in hours, and moves the Target of a task with a
 * Start to the day its new duration ends, after the hours of the tasks before it on its first day. All of
 * it is one write. Refuses an issue outside the plan, a story or an epic (they sum their tasks), an
 * estimate outside 0 to 1000 hours and a Project without the fields. Returns what changed.
 */
export async function setSize(deps: ShapingDeps, projectId: string, input: SizeInput) {
  if (input.estimate !== undefined && input.estimate !== null && !(Number.isFinite(input.estimate) && input.estimate >= 0 && input.estimate <= MAX_ESTIMATE)) {
    throw new Error(`An estimate is hours from 0 to ${MAX_ESTIMATE}.`);
  }
  const planned = await plannedProject(deps, projectId);
  const { plan, repo, number, project } = planned;
  const [items, found, proposals] = await Promise.all([plan.listItems(repo.owner, number, repo), plan.getProject(repo.owner, number), latestProposals(deps.db, project.id)]);
  const item = items.find((i) => i.number === input.issue);
  if (!item) throw new Error(`#${input.issue} is not in the plan of ${project.name}. Add it with plan_issue first.`);
  if (item.kind === "story" || item.kind === "epic") throw new Error(`#${input.issue} is ${article(item.kind)}. Only tasks have a size; stories and epics sum their tasks.`);
  const fields = found?.estimateFields;
  if (!fields?.size || !fields.estimate) {
    throw new Error(`GitHub Project #${number} has no Size and no Estimate field. Add them with Add the fields on the Plan timeline, or run setup_plan.`);
  }

  const estimate = input.estimate === undefined ? undefined : input.estimate || null;
  const changed = {
    ...item,
    size: input.size === undefined ? item.size : (input.size ?? undefined),
    estimate: estimate === undefined ? item.estimate : (estimate ?? undefined),
  };
  const target = item.start ? await followingTarget(deps.db, project.id, items.map((i) => (i.number === item.number ? changed : i)), item.number, proposals) : undefined;
  const writes: PlanFields = {
    ...(input.size !== undefined ? { size: input.size } : {}),
    ...(estimate !== undefined ? { estimate } : {}),
    ...(target && target !== item.target ? { target } : {}),
  };
  const result = await plan.setPlanFields(repo, number, item.number, writes);
  if (result !== "set") {
    const why = { "not-in-project": "it is not in the Project", "no-field": "the Project lacks a field; run setup_plan", "no-option": "the Size field has no such option; run setup_plan" }[result];
    throw new Error(`#${item.number} could not be sized: ${why}.`);
  }
  return {
    issue: item.number,
    ...(writes.size !== undefined ? { size: { from: item.size ?? null, to: writes.size } } : {}),
    ...(writes.estimate !== undefined ? { estimate: { from: item.estimate ?? null, to: writes.estimate } } : {}),
    ...(writes.target ? { target: { from: item.target ?? null, to: writes.target } } : {}),
  };
}

/** A drop on the timeline: the new Start and Target (null clears), and a manual estimate in hours when the drop set or cleared one. */
export type MoveInput = { issue: number; start: string | null; target: string | null; estimate?: number | null };

/**
 * Writes a task's Start and Target, and its manual estimate when given, as one write after one read of the
 * item: the timeline's drop, its keyboard moves and their Undo. The dashboard computes the Target that
 * follows; this checks the dates and refuses a Target before Start, and reads no other item of the plan.
 */
export async function moveItem(deps: ShapingDeps, projectId: string, input: MoveInput) {
  checkDates(`#${input.issue}`, input.start, input.target);
  if (input.estimate !== undefined && input.estimate !== null && !(Number.isFinite(input.estimate) && input.estimate >= 0 && input.estimate <= MAX_ESTIMATE)) {
    throw new Error(`An estimate is hours from 0 to ${MAX_ESTIMATE}.`);
  }
  const { plan, repo, number } = await plannedProject(deps, projectId);
  const estimate = input.estimate === undefined ? undefined : input.estimate || null;
  const fields: PlanFields = { start: input.start, target: input.target, ...(estimate !== undefined ? { estimate } : {}) };
  const result = await plan.setPlanFields(repo, number, input.issue, fields);
  if (result !== "set") {
    const why = { "not-in-project": "it is not in the Project", "no-field": "the Project lacks a field; run setup_plan", "no-option": "the Project lacks a field; run setup_plan" }[result];
    throw new Error(`#${input.issue} could not be moved: ${why}.`);
  }
  return { issue: input.issue, start: input.start, target: input.target, ...(estimate !== undefined ? { estimate } : {}) };
}

/**
 * The Target that follows from a task's Start and duration, with the tasks that start the same day before it
 * in blocker order; undefined for a task without a duration, which keeps its dates.
 */
async function followingTarget(db: Db, projectId: string, items: PlanItem[], issue: number, proposals: Map<number, Proposal>) {
  const byNumber = new Map(items.map((i) => [i.number, i]));
  const { forecasts, capacity } = await loadForecasts(db, projectId, (n) => byNumber.get(n)?.size);
  const durations = new Map(
    items.flatMap((i) => {
      const duration = i.kind !== "story" && i.kind !== "epic" ? durationOf(i, forecasts, proposals.get(i.number)?.size) : undefined;
      return duration ? [[i.number, duration] as const] : [];
    }),
  );
  return sizedBars(items, { durations, capacity }).get(issue)?.end;
}

/**
 * Sets, moves or clears the Start and Target dates of plan items, each with its own dates. Every item
 * is checked before anything is written: a date that is not YYYY-MM-DD, a Target before its Start
 * (counting the date an item keeps), an issue outside the plan, a Project without the date fields.
 * Returns each item's old and new dates.
 */
export async function schedule(deps: ShapingDeps, projectId: string, items: ScheduleItem[]) {
  if (!items.length) throw new Error("Give at least one issue to schedule.");
  const seen = new Set<number>();
  for (const { issue } of items) {
    if (seen.has(issue)) throw new Error(`#${issue} appears twice. Give each issue once, with both of its dates.`);
    seen.add(issue);
  }
  const planned = await plannedProject(deps, projectId);
  const { plan, repo, number, project } = planned;
  const [inPlan] = await Promise.all([plan.listItems(repo.owner, number, repo), requireDateFields(planned)]);
  const byNumber = new Map(inPlan.map((i) => [i.number, i]));
  const changes = items.map((change) => {
    const item = byNumber.get(change.issue);
    if (!item) throw new Error(`#${change.issue} is not in the plan of ${project.name}. Add it with plan_issue first.`);
    const start = change.start === undefined ? item.start : change.start;
    const target = change.target === undefined ? item.target : change.target;
    checkDates(`#${change.issue}`, start, target);
    return { change, item };
  });
  await Promise.all(
    changes.map(async ({ change }) => {
      const dates = { ...(change.start !== undefined ? { start: change.start } : {}), ...(change.target !== undefined ? { target: change.target } : {}) };
      const result = await plan.setDates(repo, number, change.issue, dates);
      if (result !== "set") throw new Error(`#${change.issue} could not be scheduled: ${result === "no-field" ? "the Project has no Start or Target field; run setup_plan" : "it is not in the Project"}.`);
    }),
  );
  const scheduled = changes.map(({ change, item }) => ({
    issue: item.number,
    kind: item.kind ?? null,
    title: item.title,
    ...(change.start !== undefined ? { start: { from: item.start ?? null, to: change.start } } : {}),
    ...(change.target !== undefined ? { target: { from: item.target ?? null, to: change.target } } : {}),
  }));
  const summary = scheduled
    .map((s) => {
      const moves = [s.start && `Start ${shown(s.start.from)} to ${shown(s.start.to)}`, s.target && `Target ${shown(s.target.from)} to ${shown(s.target.to)}`].filter(Boolean);
      return `#${s.issue} ${s.title}: ${moves.length ? moves.join(", ") : "unchanged"}`;
    })
    .join("; ");
  return { scheduled, summary };
}

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
