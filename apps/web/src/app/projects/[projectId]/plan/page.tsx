import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { PlanEmpty, type PlanEmptyReason } from "@/components/plan/plan-empty";
import { PlanHeader } from "@/components/plan/plan-header";
import { PlanTab } from "@/components/plan/plan-tab";
import { getDb } from "@/lib/db";
import { getGitHub, getProjects } from "@/lib/github";
import { parsePlanFilters } from "@/lib/plan/filters";
import { layoutFlow } from "@/lib/plan/flow";
import { readyInBacklog } from "@/lib/plan/task";
import { parsePlanView, parseZoom } from "@/lib/project-tab";
import { projectCrumb } from "@/server/crumbs";
import { getProjectDetail } from "@/server/graphs";
import { loadPlan, type PlanUnavailable } from "@/server/plan";
import { lastGitHubActivity } from "@/server/plan-activity";
import { planSignals } from "@/server/plan-signals";
import { tokenUser } from "@/server/assignees";
import { planAssignAction, planPeopleAction } from "@/app/projects/issue-actions";
import { SchedulerCard } from "@/components/scheduler/scheduler-card";
import { loadSchedulerCard, nextPlaces } from "@/server/scheduler-card";

export const dynamic = "force-dynamic";

/** Everything the page shows, read together, with the moment GitHub was read for the refresh line. */
async function loadPlanPage(projectId: string) {
  const db = getDb();
  const [detail, plan, activity, me] = await Promise.all([
    getProjectDetail(db, projectId),
    loadPlan(db, getGitHub(), getProjects(), projectId),
    lastGitHubActivity(db, projectId),
    tokenUser(getGitHub()),
  ]);
  const tasks = "reason" in plan ? [] : Object.values(plan.board).flat();
  // The scheduler's Next up comes from this read of the plan while its last check has none.
  const [signals, scheduler] =
    detail && !("reason" in plan)
      ? await Promise.all([planSignals(db, projectId, tasks), loadSchedulerCard(db, projectId, { items: tasks, priorityOptions: plan.project.priorityOptions })])
      : [{ needsYou: [], skipped: {} }, undefined];
  const crumbs = detail ? [projectCrumb(detail.project), { label: "Plan" }] : [];
  return { detail, plan, activity, signals, scheduler, crumbs, me, readAt: Date.now() };
}

/**
 * The empty state for a plan that cannot be shown. An organization's SSO or its block on classic tokens is no
 * missing scope: its sentence says what to do instead of the scope commands.
 */
function emptyReason({ reason, access }: PlanUnavailable): PlanEmptyReason {
  if (reason === "no-plan") return "no-plan";
  if (reason !== "no-scope") return "unreachable";
  return access === "sso" || access === "classic-blocked" ? "refused" : "no-scope";
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
  const { detail, plan, activity, signals, scheduler, crumbs, me, readAt } = await loadPlanPage(projectId);
  if (!detail || ("reason" in plan && plan.reason === "not-found")) notFound();
  const { project, graphs, defaultGraph } = detail;

  if ("reason" in plan) {
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
        <PageHeader crumbs={crumbs} title="Plan" description={`Epics, stories and tasks for ${project.name}, from a GitHub Project.`} />
        <PlanEmpty
          reason={emptyReason(plan)}
          error={plan.error}
          project={{ id: project.id, name: project.name, repo: `${project.repoOwner}/${project.repoName}` }}
        />
      </main>
    );
  }

  // In a Flow project the Next tags come from the flow's order in every view (docs/plans/flow.md, Decision 3).
  const flow = plan.flow && layoutFlow(plan.flow);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-3 p-6">
      <PlanHeader crumbs={crumbs} projectId={project.id} project={plan.project} ready={readyInBacklog(plan.board.Ready)} />
      {scheduler && !project.isDemo && (
        <SchedulerCard
          project={{ id: project.id, name: project.name }}
          card={scheduler}
          form={{ graphs: graphs.map((g) => g.name), defaultGraph, planNumber: plan.project.number, priority: plan.project.prioritySource }}
          start={{ graphs: graphs.map((g) => g.name), graphName: defaultGraph }}
          now={new Date(readAt)}
        />
      )}
      <PlanTab
        next={scheduler && nextPlaces(scheduler, flow)}
        scheduler={scheduler && { state: scheduler.status.state, claudeSlots: scheduler.status.claudeSlots }}
        project={project}
        plan={plan}
        view={parsePlanView(query, project.planMode)}
        zoom={parseZoom(query)}
        filters={parsePlanFilters(query)}
        signals={signals}
        start={{ graphs: graphs.map((g) => g.name), graphName: project.isDemo ? undefined : defaultGraph }}
        readAt={readAt}
        activity={activity}
        me={me}
        // Rows and cards assign through GitHub; the server actions are bound to this project.
        assign={project.isDemo ? undefined : { people: planPeopleAction.bind(null, project.id), assign: planAssignAction.bind(null, project.id) }}
      />
    </main>
  );
}
