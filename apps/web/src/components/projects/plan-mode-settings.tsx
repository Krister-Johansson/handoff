"use client";

import { useId, useState, useTransition } from "react";
import { InfoIcon } from "lucide-react";
import type { PlanMode } from "@handoff/db";
import { setPlanModeAction } from "@/app/projects/actions";
import { CARD_BODY, SectionCard } from "@/components/section-card";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

type Bar = { left: number; top: number; width: number; tone: "running" | "next" | "done" };

const TONE: Record<Bar["tone"], string> = {
  running: "bg-attention-dot/70",
  next: "bg-active-dot/55",
  done: "bg-muted-foreground/40",
};

// Sample bars for the two pictures: lanes of cards in order around a Now line, and dated bars under five days.
const FLOW_BARS: Bar[] = [
  { left: 2, top: 10, width: 22, tone: "running" },
  { left: 26, top: 10, width: 22, tone: "next" },
  { left: 50, top: 10, width: 30, tone: "next" },
  { left: 4, top: 28, width: 16, tone: "running" },
  { left: 22, top: 28, width: 14, tone: "next" },
  { left: 38, top: 28, width: 24, tone: "next" },
  { left: 64, top: 28, width: 18, tone: "next" },
  { left: 2, top: 46, width: 10, tone: "running" },
  { left: 14, top: 46, width: 26, tone: "next" },
  { left: 42, top: 46, width: 14, tone: "next" },
  { left: 58, top: 46, width: 30, tone: "next" },
];
const TIMELINE_BARS: Bar[] = [
  { left: 2, top: 19, width: 30, tone: "done" },
  { left: 18, top: 31, width: 24, tone: "running" },
  { left: 40, top: 43, width: 36, tone: "next" },
  { left: 60, top: 55, width: 30, tone: "next" },
];
const DAYS = ["Mon 5", "Tue 6", "Wed 7", "Thu 8", "Fri 9"];

/** A small picture of the mode's view: Flow's lanes with a Now line, or the Timeline's bars under days. */
function Picture({ mode }: { mode: PlanMode }) {
  const bars = mode === "flow" ? FLOW_BARS : TIMELINE_BARS;
  return (
    <span aria-hidden className="relative block h-16 overflow-hidden rounded-md border bg-muted/60">
      {mode === "timeline" && (
        <span className="absolute inset-x-0 top-0 flex h-[13px] border-b">
          {DAYS.map((day) => (
            <span key={day} className="flex-1 border-l pl-[3px] font-mono text-[8px] leading-[13px] font-medium text-muted-foreground first:border-l-0">
              {day}
            </span>
          ))}
        </span>
      )}
      {bars.map((bar) => (
        <i key={`${bar.left}-${bar.top}`} className={cn("absolute block h-2 rounded-[3px]", TONE[bar.tone])} style={{ left: `${bar.left}%`, top: bar.top, width: `${bar.width}%` }} />
      ))}
      {mode === "flow" && <span className="absolute inset-y-0 left-[22%] w-[1.5px] bg-foreground/70" />}
    </span>
  );
}

const CHOICES: { mode: PlanMode; label: string; short: string; agents: string }[] = [
  { mode: "flow", label: "Flow", short: "Order, no dates", agents: "set only the order and the blockers: what starts first and what waits for what. No dates." },
  { mode: "timeline", label: "Timeline", short: "Dates and estimates", agents: "set Start and Target dates and sizes, and schedule work by date." },
];

/**
 * Project settings' Plan mode: Flow or Timeline as two radio cards, each with a small picture and what agents
 * do in it. Save writes the picked mode. The page keys the section on the saved mode, so `initial` is what is
 * saved and a save shows it again.
 */
export function PlanModeSettings({ projectId, initial }: { projectId: string; initial: PlanMode }) {
  const id = useId();
  const [picked, setPicked] = useState<PlanMode>(initial);
  const [error, setError] = useState<string>();
  const [saving, startSaving] = useTransition();
  const save = () =>
    startSaving(async () => {
      const result = await setPlanModeAction({ projectId, mode: picked });
      setError(result.ok ? undefined : result.error);
    });
  return (
    <section aria-label="Plan mode">
      <SectionCard title="Plan mode" description="How this project plans its work. The Plan page, the planner and the MCP tools all follow it.">
        <div className={cn(CARD_BODY, "flex flex-col gap-3.5")}>
          <RadioGroup value={picked} onValueChange={(value) => setPicked(value as PlanMode)} aria-label="Plan mode" className="grid gap-3 sm:grid-cols-2">
            {CHOICES.map((choice) => (
              <label
                key={choice.mode}
                className={cn(
                  "flex cursor-pointer flex-col gap-2.5 rounded-lg border px-3.5 pt-3 pb-3.5 transition-colors hover:bg-muted/40 has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                  picked === choice.mode && "border-foreground ring-1 ring-foreground",
                )}
              >
                <span className="flex items-start gap-2.5">
                  <RadioGroupItem value={choice.mode} aria-label={choice.label} aria-describedby={`${id}-${choice.mode}-short ${id}-${choice.mode}-agents`} className="mt-0.5" />
                  <span className="flex flex-col">
                    <span className="text-[13.5px] font-semibold">{choice.label}</span>
                    <span id={`${id}-${choice.mode}-short`} className="text-xs text-muted-foreground">
                      {choice.short}
                    </span>
                  </span>
                </span>
                <Picture mode={choice.mode} />
                <span id={`${id}-${choice.mode}-agents`} className="text-[12.5px] leading-[1.45] text-muted-foreground">
                  <b className="font-medium text-foreground">Agents</b> {choice.agents}
                </span>
              </label>
            ))}
          </RadioGroup>
          <p className="flex items-start gap-2 text-[12.5px] leading-normal text-muted-foreground">
            <InfoIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>
              The Plan page shows Flow or Timeline to match. A tool for the other mode says so instead of doing the work, for example <span className="font-mono">schedule</span> in a Flow project.
            </span>
          </p>
          {error && <FieldError>{error}</FieldError>}
          <div className="flex flex-wrap items-center gap-2.5">
            <Button size="sm" onClick={save} disabled={saving || picked === initial}>
              Save
            </Button>
            <span className="text-xs text-muted-foreground">Switching to Timeline keeps the order. Tasks get dates when someone or an agent schedules them.</span>
          </div>
        </div>
      </SectionCard>
    </section>
  );
}
