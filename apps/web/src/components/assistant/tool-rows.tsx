import { BanIcon, CheckIcon, ChevronRightIcon, Loader2Icon, XIcon } from "lucide-react";
import { Tag } from "@/components/tag";
import type { ToolCallView } from "@/lib/assistant/port";
import { cn } from "@/lib/utils";

const ICON = {
  done: <CheckIcon aria-hidden className="size-[13px] flex-none text-success" />,
  running: <Loader2Icon aria-hidden className="size-[13px] flex-none animate-spin text-active motion-reduce:animate-none" />,
  failed: <XIcon aria-hidden className="size-[13px] flex-none text-danger" />,
  denied: <BanIcon aria-hidden className="size-[13px] flex-none text-muted-foreground" />,
};
const TAG = { running: "active", failed: "danger", denied: "outline" } as const;

/**
 * A reply's tool calls as compact rows in one list: a status icon, the title and a one-line summary.
 * Done shows only the check; running, failed and denied carry a tag. A row opens to its raw result.
 */
export function ToolRows({ calls, className }: { calls: ToolCallView[]; className?: string }) {
  if (!calls.length) return null;
  return (
    <ul className={cn("overflow-hidden rounded-md border bg-subtle text-xs", className)}>
      {calls.map((call) => (
        <li key={call.id} className="border-t first:border-t-0" role="group" aria-label={call.title}>
          <details className="group/row">
            <summary className="flex h-[30px] min-w-0 cursor-pointer list-none items-center gap-2 pr-2 pl-2.5 [&::-webkit-details-marker]:hidden">
              {ICON[call.status]}
              <span className="flex-none font-medium whitespace-nowrap text-foreground/85">{call.title}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{call.summary}</span>
              {call.status !== "done" && (
                <Tag tone={TAG[call.status]} className="h-[18px] flex-none px-1.5 text-[10.5px]">
                  {call.status}
                </Tag>
              )}
              <ChevronRightIcon aria-hidden className="size-[13px] flex-none text-muted-foreground/70 transition-transform group-open/row:rotate-90" />
            </summary>
            {call.result !== undefined && (
              <pre className="mx-2 mb-2 ml-[31px] max-h-[120px] overflow-auto rounded-md bg-terminal px-2.5 py-1.5 font-mono text-[11px] leading-[1.55] whitespace-pre-wrap text-terminal-foreground">
                {call.result}
              </pre>
            )}
          </details>
        </li>
      ))}
    </ul>
  );
}
