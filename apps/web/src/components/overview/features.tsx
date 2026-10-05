import Link from "next/link";
import { GitPullRequestIcon, LayersIcon } from "lucide-react";
import { KindBadge, StatusPill } from "@/components/plan/plan-status";
import { StatusBadge } from "@/components/runs/status-badge";
import { issuePath, runPath } from "@/lib/paths";
import { COLUMN_TONE, hasActiveRun, prNumberOf } from "@/lib/plan/task";
import { cn } from "@/lib/utils";
import type { OverviewFeature, OverviewTask } from "@/server/overview";
import type { PlanColumn, PlanProgress } from "@/server/plan";
import { NeedsYouChip } from "./overview-runs";
import { OverviewEmpty, OverviewList, OverviewSection } from "./overview-section";

/** Done first, then the work in flight, then what waits: the Plan tree's order. */
const SEGMENTS: PlanColumn[] = ["Done", "In review", "Running", "Ready", "Shaping", "Other"];

/** An epic's or a milestone's tasks as one bar coloured by status, with a legend that counts each status. */
export function FeatureProgress({ progress }: { progress: Pick<PlanProgress, "byStatus" | "total"> }) {
  const parts = SEGMENTS.filter((c) => progress.byStatus[c] > 0);
  return (
    <div className="flex flex-col gap-2">
      <span role="img" aria-label={parts.map((c) => `${progress.byStatus[c]} ${c}`).join(", ")} className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {parts.map((c) => (
          <span key={c} className={cn("h-full", COLUMN_TONE[c].dot)} style={{ width: `${(progress.byStatus[c] / progress.total) * 100}%` }} />
        ))}
      </span>
      <span aria-hidden className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
        {parts.map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", COLUMN_TONE[c].dot)} />
            <b className="font-semibold text-foreground tabular-nums">{progress.byStatus[c]}</b> {c}
          </span>
        ))}
      </span>
    </div>
  );
}

/** What a moving task shows at its end: Needs you while its run waits on a person, else its pull request in review, else its run. */
function TaskEnd({ task, projectId, repoUrl }: { task: OverviewTask; projectId: string; repoUrl: string }) {
  if (task.needsYou) return <NeedsYouChip />;
  const pr = prNumberOf(task);
  if (pr !== undefined && (task.status === "In review" || !task.run)) {
    return (
      <a href={`${repoUrl}/pull/${pr}`} aria-label={`PR #${pr}`} className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline">
        <GitPullRequestIcon aria-hidden className="size-3.5" />#{pr}
      </a>
    );
  }
  if (!task.run) return null;
  return (
    <Link href={runPath(projectId, task.run.id)} className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <StatusBadge status={task.run.status} />
    </Link>
  );
}

function Feature({ feature, projectId, repoUrl }: { feature: OverviewFeature; projectId: string; repoUrl: string }) {
  const titleId = `feature-${feature.number}`;
  return (
    <li aria-labelledby={titleId} className="flex flex-col">
      <div className="flex flex-col gap-2.5 px-4 pt-3 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <KindBadge kind="epic" />
          <span className="font-mono text-xs text-muted-foreground">#{feature.number}</span>
          <Link id={titleId} href={issuePath(projectId, feature.number)} className="min-w-0 truncate text-sm font-semibold hover:underline hover:underline-offset-3">
            {feature.title}
          </Link>
          <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {feature.progress.done} of {feature.progress.total} done
          </span>
        </div>
        <FeatureProgress progress={feature.progress} />
      </div>
      <ul className="flex flex-col divide-y border-t">
        {feature.tasks.map((task) => (
          <li key={task.number} className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 px-4 py-2">
            <StatusPill column={task.status ?? "Other"} spinning={task.status === "Running" && hasActiveRun(task) && !task.needsYou} />
            <Link href={issuePath(projectId, task.number)} className="min-w-0 flex-1 truncate text-[13px] hover:underline hover:underline-offset-3" title={task.title}>
              <span className="font-mono text-xs text-muted-foreground">#{task.number}</span> {task.title}
            </Link>
            <span className="ml-auto shrink-0">
              <TaskEnd task={task} projectId={projectId} repoUrl={repoUrl} />
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/** The epics with a task Running or In review: how far along each is, and only those tasks. */
export function FeaturesInProgress({ features, projectId, repoUrl }: { features: OverviewFeature[]; projectId: string; repoUrl: string }) {
  return (
    <OverviewSection id="features" title="Features in progress" count={features.length} more={{ href: `/projects/${projectId}/plan`, label: "Open the plan" }}>
      {features.length === 0 ? (
        <OverviewEmpty icon={LayersIcon} title="No feature in progress" description="An epic shows here while one of its tasks is Running or In review." />
      ) : (
        <OverviewList>
          {features.map((feature) => (
            <Feature key={feature.number} feature={feature} projectId={projectId} repoUrl={repoUrl} />
          ))}
        </OverviewList>
      )}
    </OverviewSection>
  );
}
