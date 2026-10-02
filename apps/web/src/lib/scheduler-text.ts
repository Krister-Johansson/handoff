type EventLike = { type: string; payload: Record<string, unknown> };
type Settings = { maxRuns?: number; order?: string; graphName?: string; skipLabel?: string | null };

const short = (id: unknown) => (typeof id === "string" ? id.slice(0, 8) : "?");
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
const runs = (n: number) => `${n} ${n === 1 ? "run" : "runs"}`;

/** Where a person acted from, as the starter names it. */
const SOURCES: Record<string, string> = {
  dashboard: "the dashboard",
  "claude-code": "Claude Code",
  assistant: "the assistant",
  webmcp: "WebMCP",
  cli: "the CLI",
};
const from = (by: unknown) => `from ${SOURCES[String(by)] ?? String(by)}`;
/** "from the dashboard", or nothing when the event does not say where. */
const fromPart = (by: unknown) => (typeof by === "string" ? ` ${from(by)}` : "");

const orderName = (order: unknown) => (order === "priority" ? "Priority order" : "Project order");
const skipping = (label: unknown) => (typeof label === "string" && label ? `skips tasks labelled ${label}` : "skips no label");

/** "up to 1 run, Project order, graph master": the settings as the scheduler's events record them. */
export function settingsText(s: Settings) {
  return `up to ${runs(s.maxRuns ?? 1)}, ${orderName(s.order)}, graph ${s.graphName ?? "?"}`;
}

/** Each setting that changed, as "was, now is". */
function changes(a: Settings, b: Settings): string {
  const parts: string[] = [];
  if (a.maxRuns !== b.maxRuns) parts.push(`up to ${runs(a.maxRuns ?? 1)}, now up to ${b.maxRuns ?? 1}`);
  if (a.order !== b.order) parts.push(`${orderName(a.order)}, now ${orderName(b.order)}`);
  if (a.graphName !== b.graphName) parts.push(`graph ${a.graphName}, now ${b.graphName}`);
  if ((a.skipLabel ?? null) !== (b.skipLabel ?? null)) parts.push(`${skipping(a.skipLabel)}, now ${b.skipLabel ? b.skipLabel : "none"}`);
  return parts.join("; ");
}

type HoldLike = { kind?: string; runId?: string; nodeKey?: string; prNumber?: number; toolName?: string };

/** One hold as a phrase: "run 3b9e21c4 failed at coder-1". */
export function holdPhrase(hold: HoldLike): string {
  const run = `run ${short(hold.runId)}`;
  switch (hold.kind) {
    case "failed":
      return `${run} failed at ${hold.nodeKey}`;
    case "loop":
      return `${run} ran out of rounds at ${hold.nodeKey}`;
    case "question":
      return `${run} asks a question at ${hold.nodeKey}`;
    case "review":
      return `${run} waits for your review at ${hold.nodeKey}`;
    case "pull_request":
      return `pull request #${hold.prNumber} of ${run} waits for an approving review`;
    case "permission":
      return `${run} asks permission to use ${hold.toolName} at ${hold.nodeKey}`;
    default:
      return `${run} waits on a person`;
  }
}

function idleText(p: Record<string, unknown>) {
  if (p.reason === "planning") return `Idle: run ${short(p.runId)} is still planning; the next start waits for its plan`;
  if (p.reason === "all_skipped") return "Idle: every Ready task is skipped";
  return "Idle: no task is Ready";
}

/** A span of seconds, short: "12 s", "2 min", "3 h". */
function span(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h`;
}

/**
 * "Checked 12 s ago" once the scheduler has checked; before its first check, when that check comes,
 * so a scheduler just turned on does not read as one that found nothing.
 */
export function checkText({ checkedAt, nextCheckAt }: { checkedAt: Date | null; nextCheckAt: Date | null }, now: Date): string {
  if (checkedAt) return `Checked ${span(Math.max(0, Math.round((now.getTime() - checkedAt.getTime()) / 1000)))} ago`;
  if (!nextCheckAt) return "Not checked yet";
  const due = Math.round((nextCheckAt.getTime() - now.getTime()) / 1000);
  return due <= 0 ? "Not checked yet; first check due now" : `Not checked yet; first check in about ${span(Math.ceil(due / 5) * 5)}`;
}

/** One sentence per scheduler event, for the card's Recent column and the All events sheet. */
export function describeSchedulerEvent({ type, payload: p }: EventLike): string {
  switch (type) {
    case "scheduler.started":
      return `Turned on${fromPart(p.by)}: ${settingsText((p.settings ?? {}) as Settings)}`;
    case "scheduler.resumed":
      return `Resumed${fromPart(p.by)}`;
    case "scheduler.changed":
      return `Changed${fromPart(p.by)}: ${changes((p.from ?? {}) as Settings, (p.to ?? {}) as Settings)}`;
    case "scheduler.paused": {
      // The scheduler's own reason starts with the count; the error follows in the card's pause line.
      if (p.by === "scheduler") return `Paused itself: ${String(p.reason ?? "").split(". ")[0]}`;
      return `Paused by a person${fromPart(p.by)}${typeof p.reason === "string" && p.reason ? `: "${p.reason}"` : ""}`;
    }
    case "scheduler.stopped":
      return `Turned off${fromPart(p.by)}`;
    case "scheduler.held": {
      const holds = Array.isArray(p.holds) ? (p.holds as HoldLike[]) : [];
      const more = holds.length > 1 ? `, and ${holds.length - 1} more` : "";
      return holds[0] ? `Held: ${holdPhrase(holds[0])}${more}` : "Held";
    }
    case "scheduler.idle":
      return idleText(p);
    case "scheduler.run_started":
      return `Started run ${short(p.runId)} on #${String(p.issue)}${typeof p.place === "number" ? `, ${ordinal(p.place)} in order` : ""}`;
    case "scheduler.skipped":
      return `Skipped #${String(p.issue)}: ${String(p.reason)}`;
    case "scheduler.start_failed":
      return `Start failed: ${String(p.error)}`;
    case "scheduler.released":
      return `Let the scheduler take #${String(p.issue)} again${fromPart(p.by)}`;
    default:
      return type;
  }
}
