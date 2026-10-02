import { formatCost } from "@/lib/format";

export type FailureError = { code: string; message: string; detail?: unknown };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/**
 * Why a step failed, beyond its error line: how a Claude step ended (its result, turns, cost and last
 * message), or the files outside the plan a path check found. Nothing for other errors.
 */
export function FailureDetail({ error }: { error: FailureError | null | undefined }) {
  const detail = obj(error?.detail);
  const files = Array.isArray(detail.files) ? detail.files.map(String) : [];
  const subtype = typeof detail.subtype === "string" ? detail.subtype : undefined;
  const turns = typeof detail.turns === "number" ? detail.turns : undefined;
  const cost = typeof detail.costUsd === "number" ? detail.costUsd : undefined;
  const lastMessage = typeof detail.lastMessage === "string" && detail.lastMessage.trim() ? detail.lastMessage.trim() : undefined;
  if (!files.length && !subtype && !lastMessage) return null;
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      {(subtype || turns !== undefined || cost !== undefined) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          {subtype && (
            <span>
              Ended with <span className="font-mono text-foreground">{subtype}</span>
            </span>
          )}
          {turns !== undefined && <span>{`${turns} turns`}</span>}
          {cost !== undefined && <span>{formatCost(cost)}</span>}
        </p>
      )}
      {lastMessage && (
        <figure className="flex flex-col gap-1">
          <figcaption className="text-xs text-muted-foreground">Its last message</figcaption>
          <blockquote className="max-h-40 overflow-auto border-l-2 pl-3 whitespace-pre-wrap">{lastMessage}</blockquote>
        </figure>
      )}
      {files.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Files outside the plan</p>
          <ul className="flex flex-col gap-0.5 font-mono">
            {files.map((file) => (
              <li key={file} className="break-all">
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
