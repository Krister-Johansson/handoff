import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { PlanEmpty } from "@/components/plan/plan-empty";
import { PlanHeader } from "@/components/plan/plan-header";
import { PlanTab } from "@/components/plan/plan-tab";
import { getDb } from "@/lib/db";
import { getGitHub, getProjects } from "@/lib/github";
import { parsePlanFilters } from "@/lib/plan/filters";
import { readyInBacklog } from "@/lib/plan/task";
import { parsePlanView, parseZoom } from "@/lib/project-tab";
import { projectCrumb } from "@/server/crumbs";
import { getProjectDetail } from "@/server/graphs";
import { loadPlan } from "@/server/plan";
import { lastGitHubActivity } from "@/server/plan-activity";
import { planSignals } from "@/server/plan-signals";

export const dynamic = "force-dynamic";

/** Everything the page shows, read together, with the moment GitHub was read for the refresh line. */
async function loadPlanPage(projectId: string) {
  const db = getDb();
  const [detail, plan, activity] = await Promise.all([getProjectDetail(db, projectId), loadPlan(db, getGitHub(), getProjects(), projectId), lastGitHubActivity(db, projectId)]);
  const signals = detail && !("reason" in plan) ? await planSignals(db, projectId, Object.values(plan.board).flat()) : { needsYou: [], skipped: {} };
  const crumbs = detail ? [projectCrumb(detail.project), { label: "Plan" }] : [];
  return { detail, plan, activity, signals, crumbs, readAt: Date.now() };
}

/** A project's plan from its GitHub Project: epics, stories and tasks as a tree, a board or a timeline. */
export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const { detail, plan, activity, signals, crumbs, readAt } = await loadPlanPage(projectId);
  if (!detail || ("reason" in plan && plan.reason === "not-found")) notFound();
  const { project, graphs, defaultGraph } = detail;

  if ("reason" in plan) {
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
        <PageHeader crumbs={crumbs} title="Plan" description={`Epics, stories and tasks for ${project.name}, from a GitHub Project.`} />
        <PlanEmpty
          reason={plan.reason === "no-plan" ? "no-plan" : plan.reason === "no-scope" ? "no-scope" : "unreachable"}
          error={plan.error}
          project={{ id: project.id, name: project.name, repo: `${project.repoOwner}/${project.repoName}` }}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-3 p-6">
      <PlanHeader crumbs={crumbs} projectId={project.id} project={plan.project} ready={readyInBacklog(plan.board.Ready)} />
      <PlanTab
        project={project}
        plan={plan}
        view={parsePlanView(query)}
        zoom={parseZoom(query)}
        filters={parsePlanFilters(query)}
        signals={signals}
        start={{ graphs: graphs.map((g) => g.name), graphName: project.isDemo ? undefined : defaultGraph }}
        readAt={readAt}
        activity={activity}
      />
    </main>
  );
}
