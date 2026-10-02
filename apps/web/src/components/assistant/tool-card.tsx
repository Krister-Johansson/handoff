import { Tag } from "@/components/tag";
import type { ToolCallView } from "@/lib/assistant/port";

const TONE = { running: "active", done: "success", failed: "danger", denied: "outline" } as const;

/** A tool call in a reply: what it did, how it went, and its result, the whole of it folded away. */
export function ToolCard({ call }: { call: ToolCallView }) {
  const firstLine = call.result?.split("\n")[0]?.slice(0, 160);
  return (
    <div role="group" aria-label={call.title} className="flex flex-col gap-1 rounded-md border bg-subtle px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium">{call.title}</span>
        <Tag tone={TONE[call.status]} className={call.status === "running" ? "animate-pulse" : undefined}>
          {call.status}
        </Tag>
      </div>
      <span className="text-muted-foreground">{call.summary}</span>
      {call.result !== undefined && (
        <details>
          <summary className="cursor-pointer truncate font-mono text-[11px] text-muted-foreground">{firstLine}</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-background p-2 font-mono text-[11px] whitespace-pre-wrap">{call.result}</pre>
        </details>
      )}
    </div>
  );
}
