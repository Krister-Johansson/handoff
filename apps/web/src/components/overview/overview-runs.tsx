import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { CheckIcon, GitPullRequestIcon, HandIcon, PlayIcon } from "lucide-react";
import { StatusBadge } from "@/components/runs/status-badge";
import { formatAgo, formatCost, formatSince } from "@/lib/format";
import { runPath } from "@/lib/paths";
import { statusTone, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { OverviewRun } from "@/server/overview";
import type { RunStep } from "@/server/run-lines";
import { OverviewEmpty, OverviewList, OverviewSection } from "./overview-section";

const TEXT: Record<StatusTone, string> = {
  success: "text-success",
  active: "text-active",
  attention: "text-attention",
  danger: "text-danger",
  repaired: "text-repaired",
  neutral: "text-muted-foreground",
  muted: "text-muted-foreground",
};

const DOT: Record<StatusTone, string> = {
  success: "bg-success-dot",
  active: "bg-active-dot",
  attention: "bg-attention-dot",
  danger: "bg-danger-dot",
  repaired: "bg-repaired-dot",
  neutral: "bg-muted-foreground/50",
  muted: "bg-muted-foreground/50",
};

/** The Plan's Needs you chip; on the Overview it leads to the run's card in Needs you. */
export function NeedsYouChip() {
  return (
    <Link
      href="#needs-you"
      className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full bg-attention-bg px-2 text-xs font-medium whitespace-nowrap text-attention focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <HandIcon aria-hidden className="size-3" />
      Needs you
    </Link>
  );
}

/** The run's steps so far in order: a dot in the step's colour, its key, and how often it ran when more than once. */
function StepTrail({ steps }: { steps: RunStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol aria-label="Steps so far" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[11px] text-muted-foreground">
      {steps.map((step, i) => (
        <Fragment key={step.nodeKey}>
          {i > 0 && (
            <span aria-hidden className="h-px w-2.5 bg-border" />
          )}
          <li className={cn("inline-flex items-center gap-1.5", step.status !== "passed" && "font-medium text-foreground")}>
            <span aria-hidden className={cn("size-1.5 rounded-full", DOT[statusTone(step.status)])} />
            {step.nodeKey}
            {step.times > 1 && <span className="text-muted-foreground"> ×{step.times}</span>}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

/** The run's pull request with its icon, opening it on GitHub. */
function PrLink({ number, repoUrl }: { number: number; repoUrl: string }) {
  return (
    <a href={`${repoUrl}/pull/${number}`} aria-label={`PR #${number}`} className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline">
      <GitPullRequestIcon aria-hidden className="size-3.5" />#{number}
    </a>
  );
}

/**
 * One run: its task linking to the run page, its status, its pull request, cost and when, then what it
 * does now in its tone, and below that whatever the list adds (the steps so far).
 */
function RunRow({ run, repoUrl, when, children }: { run: OverviewRun; repoUrl: string; when: string; children?: ReactNode }) {
  const titleId = `run-${run.id}`;
  const { now } = run.line;
  return (
    <li aria-labelledby={titleId} className="flex min-w-0 flex-col gap-1.5 px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <Link id={titleId} href={runPath(run.projectId, run.id)} className="min-w-0 text-sm font-medium break-words hover:underline hover:underline-offset-3 max-sm:order-2 max-sm:basis-full">
          {run.task}
        </Link>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums max-sm:order-1">
          <StatusBadge status={run.status} />
          {run.prNumber !== null && <PrLink number={run.prNumber} repoUrl={repoUrl} />}
          <span>{[run.line.costUsd ? formatCost(run.line.costUsd) : undefined, when].filter(Boolean).join(" · ")}</span>
        </span>
      </div>
      <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]", TEXT[now.tone])}>
        {now.tone === "success" && <CheckIcon aria-hidden className="size-3.5" />}
        <span className="min-w-0">{now.text}</span>
        {children}
      </div>
    </li>
  );
}

/** Runs that succeeded in the last day, the latest first, with their pull request and when they finished. */
export function FinishedRuns({ runs, projectId, repoUrl, now }: { runs: OverviewRun[]; projectId: string; repoUrl: string; now: Date }) {
  return (
    <OverviewSection id="finished" title="Finished in the last day" count={runs.length} more={{ href: `/projects/${projectId}/runs`, label: "All runs" }}>
      {runs.length === 0 ? (
        <OverviewEmpty icon={CheckIcon} title="No run finished in the last day" description="Runs that end show here for a day after they finish." />
      ) : (
        <OverviewList>
          {runs.map((run) => (
            <RunRow key={run.id} run={run} repoUrl={repoUrl} when={formatAgo(run.finishedAt ?? run.createdAt, now)} />
          ))}
        </OverviewList>
      )}
    </OverviewSection>
  );
}

/** Every active run, newest first: where each stands, how long its current step has taken and its steps so far. */
export function RunningNow({ runs, projectId, repoUrl, now }: { runs: OverviewRun[]; projectId: string; repoUrl: string; now: Date }) {
  return (
    <OverviewSection id="running-now" title="Running now" count={runs.length} more={{ href: `/projects/${projectId}/runs`, label: "All runs" }}>
      {runs.length === 0 ? (
        <OverviewEmpty icon={PlayIcon} title="Nothing is running" description="Start a run from an issue to do, or with New run." />
      ) : (
        <OverviewList>
          {runs.map((run) => (
            <RunRow key={run.id} run={run} repoUrl={repoUrl} when={formatAgo(run.createdAt, now)}>
              {run.needsYou ? <NeedsYouChip /> : run.line.stepSince && <span className="text-muted-foreground">· {formatSince(run.line.stepSince, now)}</span>}
              <span className="basis-full">
                <StepTrail steps={run.line.steps} />
              </span>
            </RunRow>
          ))}
        </OverviewList>
      )}
    </OverviewSection>
  );
}
