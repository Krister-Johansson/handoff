"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { BanIcon, ChevronDownIcon, CircleAlertIcon, CirclePauseIcon, CircleXIcon, InfoIcon, LayersIcon, ListChecksIcon, LockIcon, RepeatIcon, ShieldQuestionIcon, TagIcon, type LucideIcon } from "lucide-react";
import { releaseTaskAction } from "@/app/projects/scheduler-actions";
import { StartRunDialog } from "@/components/projects/forms";
import type { StartRunContext } from "@/components/plan/plan-actions";
import { Tag } from "@/components/tag";
import { Button } from "@/components/ui/button";
import { planPath } from "@/lib/paths";
import { cn } from "@/lib/utils";
import type { ActiveRunView, SchedulerCard, SkippedView } from "@/server/scheduler-card";
import { SchedulerEvents } from "./scheduler-events";

type Props = { project: { id: string; name: string }; card: SchedulerCard; start?: StartRunContext | undefined; now: Date };

const LABEL = "text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase";
const DOT: Record<string, string> = { active: "bg-active-dot", attention: "bg-attention-dot", danger: "bg-danger-dot", success: "bg-success-dot" };

/** A column of the card: its label, an action on the right, and its rows. */
function Column({ label, action, children, className }: { label: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <h3 className={LABEL}>{label}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const time = (at: Date) => at.toISOString().slice(11, 16);

/** "#141 R1 Redesign tokens", the number muted. */
function IssueText({ issue }: { issue: { number: number; title: string } | null }) {
  if (!issue) return null;
  return (
    <>
      <span className="font-mono text-xs text-muted-foreground">#{issue.number}</span> {issue.title}
    </>
  );
}

/** An active run: its task, a Scheduler tag on the scheduler's own, its current step; under it what it waits for, or why it waits before its coder. */
function ActiveRun({ run, overlap }: { run: ActiveRunView; overlap: string | undefined }) {
  const waits = run.now.tone === "attention" || run.now.tone === "danger";
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-2 text-[13px]">
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[run.now.tone] ?? "bg-muted-foreground")} />
        <Link href={run.href} className="min-w-0 truncate hover:underline hover:underline-offset-3">
          {run.issue ? <IssueText issue={run.issue} /> : `Run ${run.id.slice(0, 8)}`}
        </Link>
        {run.startedBy === "scheduler" && <Tag>Scheduler</Tag>}
        {run.node && <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{run.node}</span>}
      </div>
      {overlap ? (
        <p className="flex items-start gap-1.5 pl-3.5 text-xs text-attention">
          <LayersIcon aria-hidden className="mt-0.5 size-3 shrink-0" />
          {overlap}
        </p>
      ) : (
        waits && (
          <p className="flex flex-wrap items-center gap-x-2 pl-3.5 text-xs text-attention">
            {run.now.text}
            {run.reviewHref && (
              <Link href={run.reviewHref} className="font-medium underline underline-offset-3">
                Open the review
              </Link>
            )}
          </p>
        )
      )}
    </li>
  );
}

/** Next up, numbered in the order the scheduler starts them. */
export function NextUp({ next }: { next: SchedulerCard["next"] }) {
  if (next.length === 0) return <p className="text-[13px] text-muted-foreground">Nothing to start.</p>;
  return (
    <ol aria-label="Next up" className="flex flex-col gap-1.5">
      {next.map((task, i) => (
        <li key={task.number} className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-[4px] bg-secondary font-mono text-[10px] font-semibold">{i + 1}</span>
          <span className="min-w-0 truncate">
            <IssueText issue={task} />
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The icon of a skip reason: a label, a blocker, a cancelled run, or anything else. */
function reasonIcon(reason: string): LucideIcon {
  if (reason.startsWith("labelled")) return TagIcon;
  if (reason.startsWith("blocked")) return LockIcon;
  if (reason.startsWith("cancelled")) return BanIcon;
  return InfoIcon;
}

/** A skipped task whose run a person cancelled goes back to the scheduler only when a person says so. */
function LetTakeIt({ projectId, issue }: { projectId: string; issue: number }) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  return (
    <>
      {error && <span className="text-xs text-danger">{error}</span>}
      <Button
        size="xs"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await releaseTaskAction({ projectId, issue });
            setError(result.ok ? undefined : result.error);
          })
        }
      >
        Let the scheduler take it
      </Button>
    </>
  );
}

/** The Ready tasks the scheduler passes over, each with the reason. */
export function SkippedList({ projectId, skipped, start }: { projectId: string; skipped: SkippedView[]; start?: StartRunContext | undefined }) {
  return (
    <ul aria-label="Skipped" className="flex flex-col divide-y border-t">
      {skipped.map((task) => {
        const Icon = reasonIcon(task.reason);
        return (
          <li key={task.number} className="grid min-h-8 grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-1 text-[13px] md:grid-cols-[3rem_minmax(0,1.4fr)_minmax(0,1fr)_auto]">
            <span className="font-mono text-xs text-muted-foreground">#{task.number}</span>
            <span className="min-w-0 truncate">{task.title}</span>
            <span className="col-start-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground md:col-start-auto">
              <Icon aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{task.reason}</span>
            </span>
            <span className="col-start-2 flex items-center justify-end gap-1.5 md:col-start-auto">
              {task.releasable && <LetTakeIt projectId={projectId} issue={task.number} />}
              {task.releasable && start?.graphName && (
                <StartRunDialog
                  projectId={projectId}
                  graphs={start.graphs}
                  graphName={start.graphName}
                  label="Start run"
                  variant="outline"
                  initialIssues={[{ number: task.number, title: task.title, url: "", labels: [], author: null, updatedAt: "", blockedBy: [] }]}
                />
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The last three events, with All events. */
function Recent({ project, card }: Props) {
  return (
    <Column label="Recent" action={<SchedulerEvents project={project} events={card.events} />}>
      {card.events.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nothing yet.</p>
      ) : (
        <ul aria-label="Recent" className="flex flex-col gap-1.5">
          {card.events.slice(0, 3).map((e) => (
            <li key={e.id} className="flex min-w-0 items-baseline gap-2 text-[13px]" title={e.text}>
              <time dateTime={e.at.toISOString()} className="shrink-0 font-mono text-xs text-muted-foreground">
                {time(e.at)}
              </time>
              <span className="min-w-0 truncate">{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Column>
  );
}

/** Running, or waiting on a run still planning: active runs, Next up and Recent side by side. */
function Columns(props: Props) {
  const { card } = props;
  const [showSkipped, setShowSkipped] = useState(false);
  const overlaps = new Map(card.status.overlapHeld.map((h) => [h.runId, h.text]));
  return (
    <>
    <div className="grid gap-x-6 gap-y-4 px-3.5 pt-2.5 pb-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
      <Column label="Active runs">
        {card.runs.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">None.</p>
        ) : (
          <ul aria-label="Active runs" className="flex flex-col gap-2">
            {card.runs.map((run) => (
              <ActiveRun key={run.id} run={run} overlap={overlaps.get(run.id)} />
            ))}
          </ul>
        )}
      </Column>
      <Column
        label="Next up"
        action={
          card.skipped.length > 0 && (
            <Button size="xs" variant="ghost" className="text-muted-foreground" aria-expanded={showSkipped} onClick={() => setShowSkipped(!showSkipped)}>
              {card.skipped.length} skipped
              <ChevronDownIcon data-icon="inline-end" className={cn("transition-transform", showSkipped && "rotate-180")} />
            </Button>
          )
        }
      >
        <NextUp next={card.next} />
      </Column>
      <Recent {...props} />
    </div>
    {showSkipped && (
      <div className="px-3.5 pb-2.5">
        <SkippedList projectId={props.project.id} skipped={card.skipped} start={props.start} />
      </div>
    )}
    </>
  );
}

/** Where a person acted from, as the pause line says it. */
const SOURCES: Record<string, string> = { dashboard: "the dashboard", "claude-code": "Claude Code", assistant: "the assistant", webmcp: "WebMCP", cli: "the CLI" };

/** Paused: by whom, when and why. A pause of its own after failed starts shows the error it stopped on. */
function Paused({ card }: Props) {
  const paused = card.status.paused;
  if (!paused) return null;
  if (paused.by === "scheduler") {
    return (
      <div className="flex flex-col gap-2 px-3.5 py-2.5">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
          <CircleAlertIcon aria-hidden className="size-4 text-danger" />
          <span>Paused itself at {time(paused.at)} after three failed starts.</span>
          <span className="text-muted-foreground">Fix the cause, then resume.</span>
        </p>
        {paused.reason && <p className="rounded-md bg-danger-bg px-2.5 py-1.5 font-mono text-xs break-words text-danger">{paused.reason}</p>}
      </div>
    );
  }
  const from = card.pausedFrom ? ` from ${SOURCES[card.pausedFrom] ?? card.pausedFrom}` : "";
  return (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3.5 py-2.5 text-[13px]">
      <CirclePauseIcon aria-hidden className="size-4 text-muted-foreground" />
      <span>{`Paused by a person${from} at ${time(paused.at)}${paused.reason ? `: ${paused.reason}` : ""}`}</span>
      <span className="text-muted-foreground">Active runs go on. Nothing new starts until someone resumes.</span>
    </p>
  );
}

/** Idle with no Ready task: why, and where a person moves tasks to Ready. */
function NoReady({ project }: Props) {
  return (
    <div className="flex flex-col gap-1.5 px-3.5 py-2.5">
      <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px]">
        <ListChecksIcon aria-hidden className="size-4 text-muted-foreground" />
        No task is Ready. Move shaped tasks to Ready on the Plan.
        <Button size="xs" variant="outline" asChild>
          <Link href={planPath(project.id, { status: ["Shaping"] })}>Show Shaping tasks</Link>
        </Button>
      </p>
      <p className="text-xs text-muted-foreground">Moving a task to Ready is a person&apos;s decision; the scheduler only starts Ready tasks.</p>
    </div>
  );
}

/** Idle with every Ready task skipped: the list open, each with its reason. */
function AllSkipped({ project, card, start }: Props) {
  return (
    <div className="flex flex-col gap-2 px-3.5 py-2.5">
      <p className="flex items-center gap-2.5 text-[13px]">
        <ListChecksIcon aria-hidden className="size-4 text-muted-foreground" />
        Every Ready task is skipped, each for the reason below.
      </p>
      <h3 className={cn(LABEL, "flex items-center gap-1.5")}>
        Skipped <Tag tone="fill">{card.skipped.length}</Tag>
      </h3>
      <SkippedList projectId={project.id} skipped={card.skipped} start={start} />
    </div>
  );
}

const HOLD_ICON: Record<string, { icon: LucideIcon; tone: string }> = {
  failed: { icon: CircleXIcon, tone: "bg-danger-bg text-danger" },
  loop: { icon: RepeatIcon, tone: "bg-danger-bg text-danger" },
  permission: { icon: ShieldQuestionIcon, tone: "bg-attention-bg text-attention" },
};

/** Held: each hold on its line with the page that clears it, and what starts once they clear. */
function Held(props: Props) {
  const { project, card } = props;
  const { holds } = card.status;
  return (
    <>
      <div className="grid gap-x-8 gap-y-4 px-3.5 pt-2.5 pb-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Column
          label={
            <span className="inline-flex items-center gap-1.5">
              Holding new starts <Tag tone="fill">{holds.length}</Tag>
            </span>
          }
        >
          <ul aria-label="Holding new starts" className="flex flex-col gap-1.5">
            {holds.map((hold) => {
              const { icon: Icon, tone } = HOLD_ICON[hold.kind] ?? HOLD_ICON.failed!;
              const issue = card.holdIssues[hold.runId];
              return (
                <li key={`${hold.kind}:${hold.runId}:${"permissionId" in hold ? hold.permissionId : ""}`} className="flex min-w-0 items-center gap-2 text-[13px]">
                  <span aria-hidden className={cn("inline-flex size-[22px] shrink-0 items-center justify-center rounded-md", tone)}>
                    <Icon className="size-3.5" />
                  </span>
                  {issue && <span className="shrink-0 font-mono text-xs text-muted-foreground">#{issue.number}</span>}
                  <span className="min-w-0 truncate">{hold.text}</span>
                  <Button size="xs" variant="outline" className="ml-auto shrink-0" asChild>
                    <Link href={hold.href}>Open run</Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        </Column>
        <Column label="When these clear">
          <p className="text-[13px] text-muted-foreground">Within 10 seconds of the last one clearing, it starts these in order, one at a time:</p>
          <NextUp next={card.next} />
        </Column>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed px-3.5 py-2">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <InfoIcon aria-hidden className="size-3.5" />
          Holds count every run of {project.name}, also runs a person started. Active runs go on.
        </p>
        <SchedulerEvents project={project} events={card.events} />
      </div>
    </>
  );
}

/** What the scheduler is doing, under the card's header. */
export function SchedulerBody(props: Props) {
  const { state, idle } = props.card.status;
  const body = (() => {
    if (state === "paused") return <Paused {...props} />;
    if (state === "held") return <Held {...props} />;
    if (state === "idle" && idle?.reason === "no_ready" && props.card.next.length === 0) return <NoReady {...props} />;
    if (state === "idle" && idle?.reason === "all_skipped" && props.card.next.length === 0) return <AllSkipped {...props} />;
    return (
      <>
        {state === "idle" && idle && <p className="px-3.5 pt-2.5 text-[13px] text-muted-foreground">{idle.text}</p>}
        <Columns {...props} />
      </>
    );
  })();
  const error = props.card.status.error;
  return (
    <div className="border-t">
      {error && state !== "paused" && (
        <p className="flex items-start gap-2 border-b bg-danger-bg px-3.5 py-2 text-xs text-danger">
          <CircleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
          <span className="break-words">The last check failed: {error}</span>
        </p>
      )}
      {body}
    </div>
  );
}

