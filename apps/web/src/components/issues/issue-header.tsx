import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarIcon, CircleCheckIcon, CircleDotIcon, CircleUserIcon, LayersIcon, LockIcon, TagIcon } from "lucide-react";
import type { StartRunContext } from "@/components/plan/plan-actions";
import { ProgressBar, StatusPill } from "@/components/plan/plan-status";
import { TaskTags } from "@/components/plan/plan-task-parts";
import { Tag } from "@/components/tag";
import { TopBarCrumbs } from "@/components/top-bar";
import { dayOf, spanText } from "@/lib/issue-dates";
import { issuePath, planPath } from "@/lib/paths";
import { hasActiveRun, movesOf, taskColumn } from "@/lib/plan/task";
import type { FoundIssue, IssueKind, IssueRun } from "@/server/issue-page";
import { Assignees } from "./assignees";
import { MoveButton, PlanItButton, ScheduleButton, ShowInPlan, StartRunButton } from "./issue-actions";
import { OpenOnGitHub } from "./issue-section";
import { issueCrumbs, type ProjectRef } from "./issue-crumbs";

const KIND_LABEL: Record<IssueKind, string> = { task: "Task", story: "Story", epic: "Epic", issue: "Issue" };

const ACTIVE = new Set(["queued", "running", "waiting"]);

/** One fact on the header's line: an icon, then its text or chips. */
function Fact({ icon: Icon, children }: { icon?: typeof TagIcon; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground [&>svg]:size-3.5 [&>svg]:shrink-0">
      {Icon && <Icon aria-hidden />}
      {children}
    </span>
  );
}

/** "Blocked by #145, #148", each opening its issue page: the open blockers GitHub records. */
function BlockedBy({ numbers, projectId }: { numbers: number[]; projectId: string }) {
  if (numbers.length === 0) return null;
  return (
    <Tag tone="fill" title="A run can start once these are closed">
      <LockIcon aria-hidden />
      <span>Blocked by</span>
      {numbers.map((n, i) => (
        <span key={n}>
          <Link href={issuePath(projectId, n)} className="font-mono hover:underline">
            #{n}
          </Link>
          {i < numbers.length - 1 && ","}
        </span>
      ))}
    </Tag>
  );
}

/** The dates on the header: a task's Start and Target, a story's span from its tasks when it has none of its own, an epic's own. */
function datesOf(page: FoundIssue): string | undefined {
  const { place } = page;
  if (!place.planned) return undefined;
  const own = spanText(place.item.start, place.item.target);
  if (own || place.kind !== "story") return own;
  const derived = place.timeline?.items.find((i) => i.number === place.item.number)?.derived;
  return derived ? `${spanText(derived.start, derived.end)}, from its tasks` : undefined;
}

/** The moves and the run the issue's status allows, in the Plan's order: the main one last. */
function Actions({ page, project, start, runs }: { page: FoundIssue; project: ProjectRef; start: StartRunContext; runs: IssueRun[] }) {
  const { place, issue } = page;
  const openBlockers = page.blockedBy.filter((b) => b.state === "open").length;
  const startable = (ok: boolean) => ok && openBlockers === 0 && start.graphName !== undefined && issue.state === "open";
  const startRun = start.graphName !== undefined && <StartRunButton issue={issue} projectId={project.id} graphs={start.graphs} graphName={start.graphName} />;
  const schedule = <ScheduleButton projectId={project.id} item={{ number: issue.number, title: issue.title, start: place.planned ? place.item.start : undefined, target: place.planned ? place.item.target : undefined }} />;
  if (!place.planned) {
    return (
      <>
        {place.project && <PlanItButton issue={issue} projectId={project.id} stories={place.stories} />}
        {startable(!ACTIVE.has(runs[0]?.status ?? "")) && startRun}
      </>
    );
  }
  if (place.kind !== "task") {
    const epic = place.kind === "epic" ? place.item.number : place.parents.find((p) => p.kind === "epic")?.number;
    return (
      <>
        <ShowInPlan href={planPath(project.id, epic !== undefined ? { epic } : {})} />
        {schedule}
      </>
    );
  }
  const task = place.item;
  return (
    <>
      {schedule}
      {movesOf(task).map((move) => (
        <MoveButton key={move} move={move} issue={issue} projectId={project.id} />
      ))}
      {startable(taskColumn(task) === "Ready" && !hasActiveRun(task)) && startRun}
    </>
  );
}

/** Where the issue stands in the plan: a task's status, a story's progress, an epic's size, or unplanned. */
function Standing({ page, projectId }: { page: FoundIssue; projectId: string }) {
  const { place } = page;
  if (!place.planned) return <Tag>unplanned</Tag>;
  if (place.kind === "story") return <ProgressBar progress={place.item.progress} />;
  if (place.kind === "epic") {
    const stories = place.item.stories.length;
    const tasks = place.item.progress.total;
    return (
      <Fact icon={LayersIcon}>
        {stories} {stories === 1 ? "story" : "stories"}, {tasks} {tasks === 1 ? "task" : "tasks"}
      </Fact>
    );
  }
  const column = taskColumn(place.item);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusPill column={column} spinning={column === "Running" && hasActiveRun(place.item)} />
      <TaskTags task={place.item} />
      <BlockedBy numbers={page.blockedBy.filter((b) => b.state === "open").map((b) => b.number)} projectId={projectId} />
    </span>
  );
}

function Labels({ labels }: { labels: string[] }) {
  return (
    <Fact icon={TagIcon}>
      {labels.length === 0 ? (
        "No labels"
      ) : (
        <span className="inline-flex flex-wrap gap-1">
          {labels.map((l) => (
            <Tag key={l}>{l}</Tag>
          ))}
        </span>
      )}
    </Fact>
  );
}

/** The issue's open or closed mark, as GitHub shows it. */
function State({ state }: { state: "open" | "closed" }) {
  return (
    <Tag tone={state === "open" ? "outline" : "fill"} className={state === "open" ? "text-success" : "text-repaired"}>
      {state === "open" ? <CircleDotIcon aria-hidden /> : <CircleCheckIcon aria-hidden />}
      {state}
    </Tag>
  );
}

/**
 * Who and what: kind, number and title, then one wrapping line with its status, open or closed, its
 * open blockers, labels, assignees, dates and who opened it. Actions sit on the right.
 */
export function IssueHeader({ page, project, start, runs }: { page: FoundIssue; project: ProjectRef; start: StartRunContext; runs: IssueRun[] }) {
  const { issue, kind } = page;
  const label = KIND_LABEL[kind];
  const assignees = new Set(issue.assignees);
  const assignedAtStart = runs.some((r) => r.assigned !== null && assignees.has(r.assigned));
  const dates = datesOf(page);
  const crumb = kind === "story" || kind === "epic" ? `${label} #${issue.number}` : `#${issue.number} ${issue.title}`;
  return (
    <header aria-label={`${label} #${issue.number}`} className="flex flex-col gap-3">
      <TopBarCrumbs crumbs={issueCrumbs(project, page.section, crumb)} />
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-96 flex-col gap-1.5">
          <span className="flex items-center gap-2">
            <Tag className="tracking-[0.06em] uppercase">{label}</Tag>
            <span className="font-mono text-[13px] text-muted-foreground">#{issue.number}</span>
          </span>
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] break-words">{issue.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 max-md:w-full max-md:[&>*]:flex-1">
          <OpenOnGitHub url={issue.url} />
          <Actions page={page} project={project} start={start} runs={runs} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <Standing page={page} projectId={project.id} />
        <State state={issue.state} />
        <Labels labels={issue.labels} />
        <span className="inline-flex flex-wrap items-center gap-2">
          <Assignees key={issue.assignees.join(",")} projectId={project.id} issue={issue.number} assignees={issue.assignees} viewer={page.viewer} assignMe={kind === "task" || kind === "issue"} />
          {assignedAtStart && <span className="text-xs text-muted-foreground">assigned at Start run</span>}
        </span>
        {dates && <Fact icon={CalendarIcon}>{dates}</Fact>}
        {issue.author && (
          <Fact icon={CircleUserIcon}>
            <span>
              Opened by <span className="font-medium text-foreground">{issue.author}</span> on {dayOf(issue.createdAt)}
            </span>
          </Fact>
        )}
      </div>
    </header>
  );
}
