"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BrainIcon, ChevronRightIcon, MessageSquareIcon, WrenchIcon } from "lucide-react";
import { TerminalOutput } from "@/components/terminal-output";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toActivity, type ActivityItem, type ActivityStats } from "@/lib/activity";
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

function Tool({ item }: { item: Extract<ActivityItem, { kind: "tool" }> }) {
  const result = item.result && item.result.length > RESULT_CHARS ? `${item.result.slice(0, RESULT_CHARS)}\n… (cut at ${RESULT_CHARS} characters)` : item.result;
  return (
    <details className="group rounded-md border">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">{item.name}</span>
        {item.target && <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{item.target}</span>}
        {item.result === undefined && (
          <Badge variant="outline" className="ml-auto shrink-0">
            running
          </Badge>
        )}
        {item.error && (
          <Badge variant="destructive" className="ml-auto shrink-0">
            error
          </Badge>
        )}
      </summary>
      <div className="px-2 pb-2">{result ? <TerminalOutput text={result} label={`${item.name} result`} /> : <p className="text-xs text-muted-foreground">No output yet.</p>}</div>
    </details>
  );
}

function Item({ item }: { item: ActivityItem }) {
  if (item.kind === "tool") return <Tool item={item} />;
  if (item.kind === "thinking")
    return (
      <div className="flex gap-2 text-sm text-muted-foreground italic">
        <BrainIcon className="mt-0.5 size-3.5 shrink-0" />
        <p className="whitespace-pre-wrap">{item.text}</p>
      </div>
    );
  return (
    <div className="flex gap-2 text-sm">
      <MessageSquareIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <p className="whitespace-pre-wrap">{item.text}</p>
    </div>
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

  const { items, stats } = useMemo(() => {
    const base = stored ?? [];
    const last = base.at(-1)?.seq ?? 0;
    return toActivity([...base, ...live.filter((e) => e.seq > last)]);
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
        <ScrollArea className="h-[min(65svh,44rem)] rounded-md border">
          <ol ref={list} className="flex flex-col gap-2 p-2">
            {items.map((item) => (
              <li key={item.key}>
                <Item item={item} />
              </li>
            ))}
          </ol>
        </ScrollArea>
      )}
    </section>
  );
}
