"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BrainIcon, ChevronRightIcon, WrenchIcon } from "lucide-react";
import { TerminalOutput } from "@/components/terminal-output";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toActivity, toChat, type ActivityItem, type ActivityStats, type ChatEntry } from "@/lib/activity";
import type { RunEvent } from "./event-stream";

const RESULT_CHARS = 6_000;

function Stats({ stats }: { stats: ActivityStats }) {
  const parts = [
    stats.model,
    `${stats.tools} tool ${stats.tools === 1 ? "call" : "calls"}`,
    stats.thinkingTokens !== undefined ? `about ${stats.thinkingTokens.toLocaleString("en")} thinking tokens` : undefined,
    stats.turns !== undefined ? `${stats.turns} turns` : undefined,
    stats.costUsd !== undefined ? `$${stats.costUsd.toFixed(2)}` : undefined,
  ].filter(Boolean);
  return <p className="text-xs text-muted-foreground">{parts.join(" · ")}</p>;
}

type Allow = (rule: string) => Promise<string>;

/** Why the CLI refused a tool call, and a button per rule that would let the node use it from the next run on. */
function Denied({ denial, allow }: { denial: NonNullable<Extract<ActivityItem, { kind: "tool" }>["denied"]>; allow: Allow }) {
  const [saved, setSaved] = useState<string>();
  return (
    <div className="mb-2 flex flex-col gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
      <p>
        <span className="font-medium">Needs approval, which a run cannot give: </span>
        <span className="font-mono">{denial.reason}</span>
      </p>
      {saved ? (
        <p className="text-muted-foreground">{saved}</p>
      ) : denial.rules.length ? (
        <div className="flex flex-wrap gap-1.5">
          {denial.rules.map((rule) => (
            <Button key={rule} type="button" size="xs" variant="outline" onClick={() => void allow(rule).then(setSaved, (e: Error) => setSaved(e.message))}>
              {`Allow ${rule} for this node`}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">No tool rule allows this: Claude Code refuses the command&apos;s shape.</p>
      )}
    </div>
  );
}

function Tool({ item, allow }: { item: Extract<ActivityItem, { kind: "tool" }>; allow: Allow }) {
  const result = item.result && item.result.length > RESULT_CHARS ? `${item.result.slice(0, RESULT_CHARS)}\n… (cut at ${RESULT_CHARS} characters)` : item.result;
  return (
    <details className="group/tool">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-0.5 text-xs [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-open/tool:rotate-90" />
        <span className="shrink-0 font-medium">{item.name}</span>
        {item.target && <span className="min-w-0 truncate font-mono text-muted-foreground">{item.target}</span>}
        {item.result === undefined && (
          <Badge variant="outline" className="ml-auto shrink-0">
            running
          </Badge>
        )}
        {item.denied ? (
          <Badge variant="outline" className="ml-auto shrink-0 border-amber-500/40 text-amber-700 dark:text-amber-300">
            denied
          </Badge>
        ) : (
          item.error && (
            <Badge variant="destructive" className="ml-auto shrink-0">
              error
            </Badge>
          )
        )}
      </summary>
      {item.denied && <Denied denial={item.denied} allow={allow} />}
      <div className="mt-1 mb-2">{item.denied ? null : result ? <TerminalOutput text={result} label={`${item.name} result`} /> : <p className="text-xs text-muted-foreground">No output yet.</p>}</div>
    </details>
  );
}

/** A quiet line that opens to show more: a thought, or a step of tool calls. */
function Fold({ icon, summary, badge, children }: { icon: ReactNode; summary: ReactNode; badge?: ReactNode; children: ReactNode }) {
  return (
    <details className="group/fold">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-0.5 text-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-open/fold:rotate-90" />
        {icon}
        <span className="min-w-0 flex-1">{summary}</span>
        {badge}
      </summary>
      <div className="mt-1.5 ml-5 flex flex-col gap-1.5 border-l pl-3">{children}</div>
    </details>
  );
}

function Entry({ entry, allow }: { entry: ChatEntry; allow: Allow }) {
  if (entry.kind === "message")
    return (
      <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-pre:my-1 prose-code:before:content-none prose-code:after:content-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.text}</ReactMarkdown>
      </div>
    );
  if (entry.kind === "thinking")
    return (
      <Fold icon={<BrainIcon className="size-3.5 shrink-0" />} summary={<span className="italic">Thought</span>}>
        <p className="text-sm whitespace-pre-wrap text-muted-foreground italic">{entry.text}</p>
      </Fold>
    );
  const badge = entry.denied ? (
    <Badge variant="outline" className="shrink-0 border-amber-500/40 text-amber-700 dark:text-amber-300">
      {`${entry.denied} denied`}
    </Badge>
  ) : entry.running ? (
    <Badge variant="outline" className="shrink-0">
      running
    </Badge>
  ) : entry.errors ? (
    <Badge variant="destructive" className="shrink-0">
      {entry.errors === 1 ? "1 error" : `${entry.errors} errors`}
    </Badge>
  ) : undefined;
  return (
    <Fold icon={<WrenchIcon className="size-3.5 shrink-0" />} summary={entry.summary} badge={badge}>
      {entry.tools.map((tool) => (
        <Tool key={tool.key} item={tool} allow={allow} />
      ))}
    </Fold>
  );
}

/**
 * What the agent in one execution thought, said and ran, as a timeline: the events stored so far,
 * then the ones that arrive on the run's live stream while the node runs.
 */
export function ExecutionActivity({ runId, executionId, live }: { runId: string; executionId: string; live: RunEvent[] }) {
  const [stored, setStored] = useState<RunEvent[]>();
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/runs/${runId}/executions/${executionId}/events`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ events: RunEvent[] }>) : { events: [] }))
      .then((body) => setStored(body.events))
      .catch(() => {});
    return () => controller.abort();
  }, [runId, executionId]);

  const { items, stats, chat } = useMemo(() => {
    const base = stored ?? [];
    const last = base.at(-1)?.seq ?? 0;
    const activity = toActivity([...base, ...live.filter((e) => e.seq > last)]);
    return { ...activity, chat: toChat(activity.items) };
  }, [stored, live]);

  const hasItems = items.length > 0;
  // Follow new activity to the bottom, unless the reader scrolled up to read; scrolling back down follows again.
  const list = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  useEffect(() => {
    const viewport = list.current?.closest<HTMLElement>("[data-slot=scroll-area-viewport]");
    if (!viewport) return;
    const onScroll = () => {
      following.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80;
    };
    viewport.addEventListener("scroll", onScroll);
    return () => viewport.removeEventListener("scroll", onScroll);
  }, [stored, hasItems]);
  useEffect(() => {
    const viewport = list.current?.closest<HTMLElement>("[data-slot=scroll-area-viewport]");
    if (viewport && following.current) viewport.scrollTop = viewport.scrollHeight;
  }, [items.length]);

  const allow: Allow = async (rule) => {
    const response = await fetch(`/api/runs/${runId}/executions/${executionId}/allow-tool`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rule }),
    });
    const body = (await response.json()) as { graph?: string; version?: number; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Could not allow it.");
    return `Saved as ${body.graph} v${body.version}. Runs started from now on can use it.`;
  };

  if (!stored) return <Skeleton className="h-24 w-full" />;
  return (
    <section aria-label="Activity" className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Activity</h3>
        <Stats stats={stats} />
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ScrollArea className="h-[min(65svh,44rem)] rounded-md border [&_[data-slot=scroll-area-viewport]>div]:!block">
          <ol ref={list} className="flex flex-col gap-2 p-2">
            {chat.map((entry) => (
              <li key={entry.key}>
                <Entry entry={entry} allow={allow} />
              </li>
            ))}
          </ol>
        </ScrollArea>
      )}
    </section>
  );
}
