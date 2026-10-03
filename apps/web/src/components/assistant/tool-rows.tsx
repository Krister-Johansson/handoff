import { BanIcon, CheckIcon, ChevronRightIcon, Loader2Icon, WrenchIcon, XIcon } from "lucide-react";
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
/** From this many calls on, the list folds under one summary row. */
const FOLD_FROM = 4;

/** "3 done, 1 failed": the calls counted by status, in a fixed order. */
function counts(calls: ToolCallView[]) {
  return (["done", "running", "failed", "denied"] as const)
    .map((status) => [status, calls.filter((c) => c.status === status).length] as const)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => `${n} ${status}`)
    .join(", ");
}

/**
 * A reply's tool calls as compact rows in one list: a status icon, the title and a one-line summary.
 * Done shows only the check; running, failed and denied carry a tag. A row opens to its raw result, unless
 * its call is drawn as a card below (`carded`). Four or more calls fold under a row that counts them.
 */
export function ToolRows({ calls, carded, className }: { calls: ToolCallView[]; carded?: ReadonlySet<string>; className?: string }) {
  if (!calls.length) return null;
  const rows = <Rows calls={calls} carded={carded} />;
  if (calls.length < FOLD_FROM) return <div className={cn("overflow-hidden rounded-md border bg-subtle text-xs", className)}>{rows}</div>;
  return (
    <details className={cn("group/fold overflow-hidden rounded-md border bg-subtle text-xs", className)}>
      <summary className="flex h-[30px] cursor-pointer list-none items-center gap-2 bg-background/40 pr-2 pl-2.5 [&::-webkit-details-marker]:hidden">
        <WrenchIcon aria-hidden className="size-[13px] flex-none text-muted-foreground" />
        <span className="flex-none font-medium">{`${calls.length} tool calls`}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{counts(calls)}</span>
        <ChevronRightIcon aria-hidden className="size-[13px] flex-none text-muted-foreground/70 transition-transform group-open/fold:rotate-90" />
      </summary>
      <div className="border-t">{rows}</div>
    </details>
  );
}

const ROW = "flex h-[30px] min-w-0 items-center gap-2 pr-2 pl-2.5";

/** A row's icon, title, summary and status. */
function RowLine({ call }: { call: ToolCallView }) {
  return (
    <>
      {ICON[call.status]}
      <span className="flex-none font-medium whitespace-nowrap text-foreground/85">{call.title}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{call.summary}</span>
      {call.status === "done" ? (
        <span className="sr-only">done</span>
      ) : (
        <Tag tone={TAG[call.status]} className="h-[18px] flex-none px-1.5 text-[10.5px]">
          {call.status}
        </Tag>
      )}
    </>
  );
}

function Rows({ calls, carded }: { calls: ToolCallView[]; carded: ReadonlySet<string> | undefined }) {
  return (
    <ul>
      {calls.map((call) => (
        <li key={call.id} className="border-t first:border-t-0" role="group" aria-label={call.title}>
          {carded?.has(call.id) ? (
            <div className={ROW}>
              <RowLine call={call} />
            </div>
          ) : (
            <details className="group/row">
              <summary className={cn(ROW, "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
                <RowLine call={call} />
                <ChevronRightIcon aria-hidden className="size-[13px] flex-none text-muted-foreground/70 transition-transform group-open/row:rotate-90" />
              </summary>
              {call.result !== undefined && (
                <pre className="mx-2 mb-2 ml-[31px] max-h-[120px] overflow-auto rounded-md bg-terminal px-2.5 py-1.5 font-mono text-[11px] leading-[1.55] whitespace-pre-wrap text-terminal-foreground">
                  {call.result}
                </pre>
              )}
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
