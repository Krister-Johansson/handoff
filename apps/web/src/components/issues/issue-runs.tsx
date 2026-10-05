import Link from "next/link";
import { CheckIcon, ClipboardCheckIcon, GitBranchIcon, HandIcon, InfoIcon, MessageCircleQuestionIcon } from "lucide-react";
import { StepTrail } from "@/components/runs/step-trail";
import { TONE_TEXT } from "@/lib/status";
import { RunStatusBadge } from "@/components/runs/status-badge";
import { Button } from "@/components/ui/button";
import { formatSince } from "@/lib/format";
import { startedAt } from "@/lib/issue-dates";
import { runPath } from "@/lib/paths";
import { cn } from "@/lib/utils";
import type { IssueRun } from "@/server/issue-page";
import { IssueSection, Quiet } from "./issue-section";

/** The chip a run waiting on a person carries, as on the Plan and the Home page. */
export function NeedsYou() {
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full bg-attention-bg px-2 text-xs font-medium whitespace-nowrap text-attention">
      <HandIcon aria-hidden className="size-3" />
      Needs you
    </span>
  );
}

/** The review or question a run waits on, with the button that answers it and the run itself. */
function Waiting({ run, projectId }: { run: IssueRun; projectId: string }) {
  if (!run.waitingOn) return null;
  const Icon = run.waitingOn.kind === "review" ? ClipboardCheckIcon : MessageCircleQuestionIcon;
  return (
    <div className="col-span-2 flex flex-wrap items-center gap-3 rounded-lg border border-attention-dot/30 bg-attention-bg px-3.5 py-2.5">
      <Icon aria-hidden className="size-4 shrink-0 text-attention" />
      <span className="min-w-0 flex-1 basis-48 text-[13px] font-medium break-words">{run.waitingOn.text}</span>
      <span className="flex shrink-0 gap-2">
        <Button size="sm" asChild>
          <Link href={run.waitingOn.href}>{run.waitingOn.kind === "review" ? "Open the review" : "Answer"}</Link>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link href={runPath(projectId, run.id)}>Open run</Link>
        </Button>
      </span>
    </div>
  );
}

/** One run on the issue: the Home page's run row with its graph, its start, its branch and what it waits on. */
function RunRow({ run, projectId, now }: { run: IssueRun; projectId: string; now: Date }) {
  const titleId = `issue-run-${run.id}`;
  const { line } = run;
  return (
    <li aria-labelledby={titleId} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 py-3 first:pt-0 last:pb-0">
      <span id={titleId} className="min-w-0 text-sm">
        <Link href={runPath(projectId, run.id)} className="font-medium hover:underline hover:underline-offset-3">
          Run {run.id.slice(0, 8)}
        </Link>{" "}
        <span className="text-muted-foreground">on</span> <span className="font-mono text-[13px]">{run.graph}</span>
      </span>
      <span className="flex justify-end">
        <RunStatusBadge status={run.status} waitingOn={line.waitingOn} />
      </span>
      <div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]", TONE_TEXT[line.now.tone])}>
        {line.now.tone === "success" && <CheckIcon aria-hidden className="size-3.5" />}
        <span className="min-w-0">{line.now.text}</span>
        {run.needsYou && <NeedsYou />}
        {line.stepSince && <span className="text-muted-foreground">· {formatSince(line.stepSince, now)}</span>}
      </div>
      <span className="pt-0.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums">started {startedAt(run.startedAt ?? run.createdAt, now)}</span>
      {line.steps.length > 0 && (
        <div className="col-span-2">
          <StepTrail steps={line.steps} />
        </div>
      )}
      <span className="col-span-2 inline-flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
        <GitBranchIcon aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{run.branch}</span>
      </span>
      <Waiting run={run} projectId={projectId} />
    </li>
  );
}

/** Every run on the issue, newest first; a cancelled latest run gives the issue back, which the footer says. */
export function IssueRuns({ runs, projectId, now, giveBack }: { runs: IssueRun[]; projectId: string; now: Date; giveBack?: boolean }) {
  const cancelled = giveBack && runs[0]?.status === "cancelled";
  return (
    <IssueSection title="Runs" count={runs.length}>
      {runs.length === 0 ? (
        <Quiet>No run has worked on it yet.</Quiet>
      ) : (
        <ul className="flex flex-col divide-y">
          {runs.map((run) => (
            <RunRow key={run.id} run={run} projectId={projectId} now={now} />
          ))}
        </ul>
      )}
      {cancelled && (
        <p className="mt-3 flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
          <InfoIcon aria-hidden className="size-3.5 shrink-0" />A cancelled run gives the issue back to the backlog, so Start run is on.
        </p>
      )}
    </IssueSection>
  );
}
