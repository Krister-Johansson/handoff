import type { PlanKind, PlanStatus } from "@handoff/github";
import { KindBadge } from "@/components/plan/plan-status";
import type { DaySpan, Timeline, TimelineItem } from "@/lib/plan/schedule";
import { BAR_TONE } from "@/lib/plan/task";
import { addDays, dayOfInstant, shortDay, timeScale } from "@/lib/plan/timeline-scale";
import { cn } from "@/lib/utils";
import type { PlanColumn } from "@/server/plan";

/** A row of the small timeline: an epic, a story or a task, with its Status when it is a task. */
export type MiniRow = { number: number; title: string; kind: PlanKind | undefined; status?: PlanStatus | undefined; state: "open" | "closed" };

const spanOf = (entry: TimelineItem | undefined): (DaySpan & { own: boolean }) | undefined =>
  entry?.planned ? { start: entry.planned.start, end: entry.planned.end, own: true } : entry?.derived ? { ...entry.derived, own: false } : undefined;

const describe = (span: DaySpan) => (span.start === span.end ? shortDay(span.start) : `${shortDay(span.start)} to ${shortDay(span.end)}`);

/**
 * A small timeline of one story or epic and the items under it: a task's bar in its status colour, a
 * story's or an epic's own dates as a neutral bar and a span derived from its tasks dashed, each run's
 * strip under its task, and Today. `compact` labels rows by number only, for the rail.
 */
export function MiniTimeline({ timeline, rows, compact }: { timeline: Timeline; rows: MiniRow[]; compact?: boolean }) {
  const entries = new Map(timeline.items.map((i) => [i.number, i]));
  const spans = rows.flatMap((r) => {
    const span = spanOf(entries.get(r.number));
    return span ? [span] : [];
  });
  if (spans.length === 0) return <p className="text-[13px] text-muted-foreground">No dates yet. Schedule sets Start and Target on the GitHub Project.</p>;
  const start = [timeline.today, ...spans.map((s) => s.start)].sort()[0]!;
  const end = [timeline.today, ...spans.map((s) => s.end)].sort().at(-1)!;
  const scale = timeScale({ start: addDays(start, -1), end: addDays(end, 1) }, "weeks");
  const pct = (x: number) => `${(x / scale.width) * 100}%`;
  const dayEnd = (day: string) => scale.x(addDays(day, 1));
  const today = scale.x(timeline.today) + (scale.x(addDays(timeline.today, 1)) - scale.x(timeline.today)) / 2;
  const label = compact ? "w-12" : "w-44 sm:w-56";
  return (
    <div role="grid" aria-label="Timeline" className="overflow-hidden rounded-md border text-xs">
      <div role="row" className="flex border-b bg-muted/40">
        <span role="columnheader" className={cn("shrink-0 border-r px-2 py-1", label)}>
          <span className="sr-only">Item</span>
        </span>
        <span role="columnheader" className="relative h-6 min-w-0 flex-1">
          {scale.bottom.map((cell) => (
            <span key={cell.x} className="absolute top-0 h-full border-l pl-1 font-mono text-[10px] leading-6 text-muted-foreground" style={{ left: pct(cell.x), width: pct(cell.width) }}>
              {compact ? cell.label : `${cell.label} ${shortDay(addDays(scale.range.start, cell.x / 14))}`}
            </span>
          ))}
        </span>
      </div>
      {rows.map((row) => {
        const entry = entries.get(row.number);
        const span = spanOf(entry);
        const column: PlanColumn = row.state === "closed" ? "Done" : (row.status ?? "Other");
        const task = row.kind !== "story" && row.kind !== "epic";
        const name = `${row.kind === "epic" ? "Epic" : row.kind === "story" ? "Story" : "Task"} #${row.number} ${row.title}${span ? ` from ${describe(span)}` : ", not scheduled"}`;
        return (
          <div role="row" key={row.number} aria-label={name} className={cn("flex border-b last:border-b-0", row.kind === "epic" && "bg-muted/40")}>
            <span role="rowheader" className={cn("flex shrink-0 items-center gap-1.5 truncate border-r px-2 py-1.5", label)} title={row.title}>
              {!compact && row.kind === "epic" && <KindBadge kind="epic" />}
              <span className="font-mono text-muted-foreground">#{row.number}</span>
              {!compact && <span className="truncate">{row.title}</span>}
            </span>
            <span role="gridcell" className="relative min-w-0 flex-1">
              <span aria-hidden className="absolute inset-y-0 w-px bg-foreground" style={{ left: pct(today) }} />
              {span && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-1/2 h-3 -translate-y-1/2 rounded-[3px]",
                    task ? cn("border", BAR_TONE[column]) : span.own ? "border border-muted-foreground/40 bg-secondary" : "border border-dashed border-muted-foreground/60",
                  )}
                  style={{ left: pct(scale.x(span.start)), width: pct(dayEnd(span.end) - scale.x(span.start)) }}
                />
              )}
              {task &&
                entry?.actual.map((strip) => (
                  <span
                    key={strip.runId}
                    aria-hidden
                    className="absolute bottom-0.5 h-[3px] rounded-full bg-attention-dot"
                    style={{ left: pct(scale.x(dayOfInstant(strip.start))), width: pct(Math.max(3, dayEnd(dayOfInstant(strip.end)) - scale.x(dayOfInstant(strip.start)))) }}
                  />
                ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
