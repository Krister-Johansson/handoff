import type { ReactNode } from "react";
import Link from "next/link";
import { CheckIcon, GitPullRequestIcon, HandIcon, PlayIcon } from "lucide-react";
import { RunStatusBadge } from "@/components/runs/status-badge";
import { StepTrail } from "@/components/runs/step-trail";
import { TONE_TEXT } from "@/lib/status";
import { formatAgo, formatCost, formatSince } from "@/lib/format";
import { runPath } from "@/lib/paths";
import { cn } from "@/lib/utils";
import type { OverviewRun } from "@/server/overview";
import { OverviewEmpty, OverviewList, OverviewSection } from "./overview-section";

/** The Plan's Needs you chip; on the Home page it leads to the run's card in Needs you. */
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
function RunRow({ run, repoUrl, when, aside, children }: { run: OverviewRun; repoUrl: string; when: string; aside?: ReactNode; children?: ReactNode }) {
  const titleId = `run-${run.id}`;
  const { now } = run.line;
  return (
    <li aria-labelledby={titleId} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 px-4 py-3">
      <Link id={titleId} href={runPath(run.projectId, run.id)} className="min-w-0 text-sm font-medium break-words hover:underline hover:underline-offset-3">
        {run.task}
      </Link>
      <span className="flex justify-end">
        <RunStatusBadge status={run.status} waitingOn={run.line.waitingOn} />
      </span>
      <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]", TONE_TEXT[now.tone])}>
        {now.tone === "success" && <CheckIcon aria-hidden className="size-3.5" />}
        <span className="min-w-0">{now.text}</span>
        {aside}
      </div>
      <span className="flex items-center justify-end gap-2 pt-0.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {run.prNumber !== null && <PrLink number={run.prNumber} repoUrl={repoUrl} />}
        <span>{[run.line.costUsd ? formatCost(run.line.costUsd) : undefined, when].filter(Boolean).join(" · ")}</span>
      </span>
      {children && <div className="col-span-2">{children}</div>}
    </li>
  );
}

/** A busy day finishes dozens of runs; the Home page shows the latest few and Runs holds the rest. */
const FINISHED_SHOWN = 5;

/** Runs that succeeded in the last day, the latest first, with their pull request and when they finished. */
export function FinishedRuns({ runs, projectId, repoUrl, now }: { runs: OverviewRun[]; projectId: string; repoUrl: string; now: Date }) {
  return (
    <OverviewSection id="finished" title="Finished in the last day" count={runs.length} more={{ href: `/projects/${projectId}/runs`, label: "All runs" }}>
      {runs.length === 0 ? (
        <OverviewEmpty icon={CheckIcon} title="No run finished in the last day" description="Runs that end show here for a day after they finish." />
      ) : (
        <OverviewList>
          {runs.slice(0, FINISHED_SHOWN).map((run) => (
            <RunRow key={run.id} run={run} repoUrl={repoUrl} when={formatAgo(run.finishedAt ?? run.createdAt, now)} />
          ))}
          {runs.length > FINISHED_SHOWN && (
            <li className="bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
              <Link href={`/projects/${projectId}/runs`} className="underline underline-offset-3 hover:text-foreground">
                {runs.length - FINISHED_SHOWN} more in Runs
              </Link>
            </li>
          )}
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
            <RunRow
              key={run.id}
              run={run}
              repoUrl={repoUrl}
              when={formatAgo(run.createdAt, now)}
              aside={run.needsYou ? <NeedsYouChip /> : run.line.stepSince && <span className="text-muted-foreground">· {formatSince(run.line.stepSince, now)}</span>}
            >
              {run.line.steps.length > 0 && <StepTrail steps={run.line.steps} />}
            </RunRow>
          ))}
        </OverviewList>
      )}
    </OverviewSection>
  );
}
