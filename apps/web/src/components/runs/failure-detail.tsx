import { formatCost } from "@/lib/format";

export type FailureError = { code: string; message: string; detail?: unknown };

type Facts = { files: string[]; subtype?: string; turns?: number; cost?: number; lastMessage?: string };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

/** What a failure's detail says about why it happened, read defensively: the detail is stored JSON. */
function factsOf(error: FailureError | null | undefined): Facts {
  const detail = obj(error?.detail);
  return {
    files: Array.isArray(detail.files) ? detail.files.map(String) : [],
    subtype: str(detail.subtype),
    turns: num(detail.turns),
    cost: num(detail.costUsd),
    lastMessage: str(detail.lastMessage),
  };
}

function HowItEnded({ subtype, turns, cost }: Pick<Facts, "subtype" | "turns" | "cost">) {
  if (!subtype && turns === undefined && cost === undefined) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
      {subtype && (
        <span>
          Ended with <span className="font-mono text-foreground">{subtype}</span>
        </span>
      )}
      {turns !== undefined && <span>{`${turns} turns`}</span>}
      {cost !== undefined && <span>{formatCost(cost)}</span>}
    </p>
  );
}

function LastMessage({ text }: { text: string | undefined }) {
  if (!text) return null;
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-xs text-muted-foreground">Its last message</figcaption>
      <blockquote className="max-h-40 overflow-auto border-l-2 pl-3 whitespace-pre-wrap">{text}</blockquote>
    </figure>
  );
}

function OutsideFiles({ files }: { files: string[] }) {
  if (!files.length) return null;
  return (
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
  );
}

/**
 * Why a step failed, beyond its error line: how a Claude step ended (its result, turns, cost and last
 * message), or the files outside the plan a path check found. Nothing for other errors.
 */
export function FailureDetail({ error }: { error: FailureError | null | undefined }) {
  const facts = factsOf(error);
  if (!facts.files.length && !facts.subtype && !facts.lastMessage) return null;
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <HowItEnded subtype={facts.subtype} turns={facts.turns} cost={facts.cost} />
      <LastMessage text={facts.lastMessage} />
      <OutsideFiles files={facts.files} />
    </div>
  );
}
