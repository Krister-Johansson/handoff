import { and, asc, desc, eq, graphs, graphVersions, inArray, isNull, projects, questions, runs, sql, type Db } from "@handoff/db";
import { GitHubReadError, type GitHubPort, type IssueComment, type IssueDetail, type IssueRef, type PlanProject, type PlanStatus, type ProjectsPort } from "@handoff/github";
import { reviewPath, runPath, tryPath } from "../lib/paths";
import { inboxGroups } from "./inbox-groups";
import { waitingRuns } from "./overview";
import { loadPlan, type PlanUnavailable } from "./plan";
import { runLines, type RunLine } from "./run-lines";

/** What a run waits on from a person: a review or a question, with the page that answers it. */
export type RunWait = { kind: "review" | "question"; text: string; href: string };

/** A run on an issue as the issue page shows it: the Overview's run row with its start, branch and what it waits on. */
export type IssueRun = {
  id: string;
  status: string;
  task: string;
  graph: string;
  version: number;
  branch: string;
  startedBy: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  prNumber: number | null;
  /** The issue's title as the run linked it, which stands in for GitHub's when GitHub does not answer. */
  issueTitle: string;
  line: RunLine;
  /** It waits on a person: a question, a review, a permission request, or it failed or got stuck. */
  needsYou: boolean;
  /** The oldest open review or question, which the row offers to open. */
  waitingOn: RunWait | null;
};

/** Where the page sits in the sidebar: Plan for an item of the plan, Issues for any other issue. */
export type IssueSection = "plan" | "issues";
export type IssueKind = "task" | "story" | "epic" | "issue";

/** An issue blocking this one or blocked by it, with its Status when it is an item of the plan. */
export type IssueLink = IssueRef & { status: PlanStatus | undefined };

/** Where an issue outside the plan stands: why, when the project's plan cannot be read or there is none. */
export type Unplanned = { planned: false; reason: PlanUnavailable["reason"] | undefined; error: string | undefined; project: PlanProject | undefined };

export type IssuePlace = Unplanned;

export type FoundIssue = {
  state: "found";
  section: IssueSection;
  kind: IssueKind;
  issue: IssueDetail;
  place: IssuePlace;
  /** Open ones first, then the closed ones, each group in GitHub's order. */
  blockedBy: IssueLink[];
  blocking: IssueLink[];
  comments: IssueComment[];
  /** The token's user, "you" on the dashboard; undefined with a GitHub App. */
  viewer: string | undefined;
};

/**
 * One issue as its page shows it, read from GitHub on every call, or why it cannot be shown: GitHub
 * does not know the number, the number is a pull request's, or GitHub did not answer (then the title
 * the latest run linked stands in, when a run linked it).
 */
export type IssuePage = FoundIssue | { state: "not-found" } | { state: "pull-request"; url: string } | { state: "unreachable"; error: string; title: string | null };

const NO_GITHUB = "Set GITHUB_TOKEN or a GitHub App for the dashboard to read the repository's issues.";

const openFirst = <T extends { state: "open" | "closed" }>(items: T[]) => [...items.filter((i) => i.state === "open"), ...items.filter((i) => i.state === "closed")];

export async function loadIssuePage(
  db: Db,
  github: GitHubPort | undefined,
  plan: ProjectsPort | undefined,
  projectId: string,
  number: number,
  opts: { runs?: IssueRun[] } = {},
): Promise<IssuePage> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return { state: "not-found" };
  const repo = { owner: project.repoOwner, name: project.repoName };
  const unreachable = async (error: string): Promise<IssuePage> => {
    const runsOf = opts.runs ?? (await issueRuns(db, projectId, number));
    return { state: "unreachable", error, title: runsOf.find((r) => r.issueTitle)?.issueTitle ?? null };
  };
  if (!github) return unreachable(NO_GITHUB);
  let issue: IssueDetail;
  try {
    issue = await github.getIssue(repo, number);
  } catch (error) {
    if (error instanceof GitHubReadError && error.reason === "not-found") return { state: "not-found" };
    return unreachable(error instanceof Error ? error.message : String(error));
  }
  if (issue.pullRequest) return { state: "pull-request", url: issue.url };
  const [dependencies, comments, viewer, planned] = await Promise.all([
    github.dependencies(repo, number),
    github.listIssueComments(repo, number),
    github.viewer().catch(() => undefined),
    loadPlan(db, github, plan, projectId),
  ]);
  const place: IssuePlace = "reason" in planned ? { planned: false, reason: planned.reason, error: planned.error, project: undefined } : { planned: false, reason: undefined, error: undefined, project: planned.project };
  const link = (ref: IssueRef): IssueLink => ({ ...ref, status: undefined });
  return {
    state: "found",
    section: "issues",
    kind: "issue",
    issue,
    place,
    blockedBy: openFirst(dependencies.blockedBy).map(link),
    blocking: openFirst(dependencies.blocking).map(link),
    comments,
    viewer,
  };
}

/** Every run whose linked issues include `number`, newest first, from handoff's own records. */
export async function issueRuns(db: Db, projectId: string, number: number): Promise<IssueRun[]> {
  const rows = await db
    .select({
      id: runs.id,
      status: runs.status,
      task: runs.task,
      issues: runs.issues,
      branch: runs.branchName,
      startedBy: runs.startedBy,
      createdAt: runs.createdAt,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      prNumber: runs.prNumber,
      graph: graphs.name,
      version: graphVersions.version,
    })
    .from(runs)
    .innerJoin(graphVersions, eq(graphVersions.id, runs.graphVersionId))
    .innerJoin(graphs, eq(graphs.id, graphVersions.graphId))
    .where(and(eq(runs.projectId, projectId), sql`${runs.issues} @> ${JSON.stringify([{ number }])}::jsonb`))
    .orderBy(desc(runs.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [lines, open, groups] = await Promise.all([
    runLines(db, ids),
    db
      .select({ id: questions.id, runId: questions.runId, question: questions.question, context: questions.context })
      .from(questions)
      .where(and(inArray(questions.runId, ids), isNull(questions.answer)))
      .orderBy(asc(questions.createdAt)),
    inboxGroups(db, { projectId }),
  ]);
  const waiting = waitingRuns({ ...groups, failedRuns: groups.failedRuns.map((f) => ({ ...f, error: f.error ?? null })) });
  return rows.flatMap(({ issues, ...run }) => {
    const line = lines.get(run.id);
    if (!line) return [];
    const asked = open.find((q) => q.runId === run.id);
    const context = (asked?.context ?? {}) as { review?: unknown; reason?: string };
    const waitingOn: RunWait | null = asked
      ? context.review
        ? { kind: "review", text: asked.question, href: reviewPath(projectId, run.id, asked.id) }
        : { kind: "question", text: asked.question, href: context.reason === "try" ? tryPath(projectId, run.id, asked.id) : runPath(projectId, run.id) }
      : null;
    const issueTitle = issues.find((i) => i.number === number)?.title ?? "";
    return [{ ...run, issueTitle, line, needsYou: waiting.has(run.id), waitingOn }];
  });
}
