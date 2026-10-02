import { formatDuration } from "@/lib/plan/duration";
import { dayWidthAt, shortDay, type TimeScale } from "@/lib/plan/timeline-scale";
import { cn } from "@/lib/utils";

/** Hours as the load row writes them, in hours and minutes whatever the capacity: "6h 50m". */
const clock = (hours: number) => formatDuration(hours, Infinity);

/** A cell narrower than this has no room for its hours. */
const TEXT_INSIDE = 40;

/**
 * The load row under the dates: planned hours per day against the person's hours a day, every scheduled
 * task with a duration counted, the ones the filters hide too. A day over the capacity is red with its hours.
 * `preview` is the part of each day's hours an Arrange preview adds, drawn on top of the rest.
 */
export function LoadRow({ scale, hours, capacity, preview }: { scale: TimeScale; hours: Record<string, number>; capacity: number; preview?: Record<string, number> | undefined }) {
  const days = Object.entries(hours).filter(([day, h]) => h > 1e-9 && day >= scale.range.start && day <= scale.range.end);
  return (
    <div className="absolute inset-x-0 top-12 h-[18px] border-t">
      {days.map(([day, h]) => {
        const width = dayWidthAt(scale, day);
        const over = h > capacity + 1e-9;
        const added = preview?.[day] ?? 0;
        const planned = Math.min(1, (h - added) / capacity);
        return (
          <span
            key={day}
            title={`${shortDay(day)}: ${clock(h)} of ${clock(capacity)}${added > 1e-9 ? `, ${clock(added)} of it in the preview` : ""}`}
            data-over={over || undefined}
            className="group/load absolute top-[3px] flex h-[11px] justify-center"
            style={{ left: scale.x(day), width }}
          >
            <b className={cn("relative block h-full overflow-hidden rounded-[2px] bg-muted group-data-over/load:bg-danger-dot", width < TEXT_INSIDE ? "w-[calc(100%-3px)]" : "w-[calc(100%-10px)]")}>
              <i className="absolute inset-x-0 bottom-0 bg-muted-foreground/45 group-data-over/load:bg-danger-dot" style={{ height: `${planned * 100}%` }} />
              {added > 1e-9 && (
                <i
                  data-preview
                  className="absolute inset-x-0 bg-[repeating-linear-gradient(135deg,var(--active-dot)_0_2px,color-mix(in_oklab,var(--active-dot)_35%,transparent)_2px_5px)]"
                  style={{ bottom: `${planned * 100}%`, height: `${Math.max(0, Math.min(1, h / capacity) - planned) * 100}%` }}
                />
              )}
            </b>
            {over && width >= TEXT_INSIDE && <span className="absolute inset-0 grid place-items-center text-[9.5px] leading-none font-semibold text-white">{clock(h)}</span>}
          </span>
        );
      })}
    </div>
  );
}
