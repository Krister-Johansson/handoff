import { CalendarClockIcon } from "lucide-react";
import { Tag } from "@/components/tag";
import { ordinal } from "@/lib/scheduler-text";

/** "Scheduler" beside a run the scheduler started, with its place in the order on hover. */
export function StartedByScheduler({ startedBy, place }: { startedBy: string | null; place: number | undefined }) {
  if (startedBy !== "scheduler") return null;
  return (
    <Tag title={`Started by the scheduler${place ? `, ${ordinal(place)} in order` : ""}`}>
      <CalendarClockIcon aria-hidden />
      Scheduler
    </Tag>
  );
}
