import { Suspense } from "react";
import { redirect } from "next/navigation";
import { and, eq, runs } from "@handoff/db";
import type { StartRunContext } from "@/components/plan/plan-actions";
import type { ProjectRef } from "@/components/issues/issue-crumbs";
import { IssueLoading, IssueNotFound, IssueUnreachable } from "@/components/issues/issue-states";
import { IssueView } from "@/components/issues/issue-view";
import { getDb } from "@/lib/db";
import { getGitHub, getProjects } from "@/lib/github";
import { runPath } from "@/lib/paths";
import { issueRuns, loadIssuePage, type IssueRun } from "@/server/issue-page";
import { projectPage } from "@/server/project-page";

export const dynamic = "force-dynamic";

/** GitHub's part of the page: the issue, its place in the plan, its blockers and comments, read on every visit. */
async function IssueContent({ project, number, runs: runsOf, start }: { project: ProjectRef; number: number; runs: IssueRun[]; start: StartRunContext }) {
  const { page, readAt } = await readIssue(project.id, number, runsOf);
  const now = new Date(readAt);
  if (page.state === "not-found") return <IssueNotFound project={project} number={number} />;
  if (page.state === "unreachable") return <IssueUnreachable project={project} number={number} title={page.title} runs={runsOf} now={now} />;
  if (page.state === "pull-request") {
    // A pull request number opens its pull request: the run that opened it, else the pull request on GitHub.
    const [run] = await getDb().select({ id: runs.id }).from(runs).where(and(eq(runs.projectId, project.id), eq(runs.prNumber, number))).limit(1);
    redirect(run ? runPath(project.id, run.id) : page.url);
  }
  return <IssueView project={project} page={page} runs={runsOf} start={start} now={now} readAt={readAt} />;
}

/**
 * One issue at /projects/<id>/issues/<number>: a task, a story, an epic or an issue outside the plan.
 * The runs come from handoff at once; GitHub's parts stream in behind skeletons.
 */
export default async function IssuePage({ params }: { params: Promise<{ projectId: string; number: string }> }) {
  const { projectId, number: raw } = await params;
  const { project, graphs, defaultGraph } = await projectPage(projectId);
  const ref = { id: project.id, name: project.name, repo: `${project.repoOwner}/${project.repoName}` };
  const number = Number(raw);
  const body = !Number.isInteger(number) || number < 1 ? (
    <IssueNotFound project={ref} number={number || 0} />
  ) : (
    <IssueWithRuns project={ref} number={number} start={{ graphs: graphs.map((g) => g.name), graphName: project.isDemo ? undefined : defaultGraph }} />
  );
  return <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6 max-sm:px-4">{body}</main>;
}

/** The issue's runs from handoff, with the moment they were read. */
async function readRuns(projectId: string, number: number) {
  return { runs: await issueRuns(getDb(), projectId, number), readAt: Date.now() };
}

/** GitHub's part, with the moment GitHub was read for the refresh line. */
async function readIssue(projectId: string, number: number, runsOf: IssueRun[]) {
  const page = await loadIssuePage(getDb(), getGitHub(), getProjects(), projectId, number, { runs: runsOf });
  return { page, readAt: Date.now() };
}

async function IssueWithRuns({ project, number, start }: { project: ProjectRef; number: number; start: StartRunContext }) {
  const { runs: runsOf, readAt } = await readRuns(project.id, number);
  return (
    <Suspense key={number} fallback={<IssueLoading project={project} number={number} runs={runsOf} at={readAt} />}>
      <IssueContent project={project} number={number} runs={runsOf} start={start} />
    </Suspense>
  );
}
