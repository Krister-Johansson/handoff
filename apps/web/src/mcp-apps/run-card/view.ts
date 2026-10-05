/**
 * The run card: get_run's answer drawn as the assistant chat's run card (Claude Design, shell/ChatPanel). Plain DOM,
 * because the view is one HTML document a host loads in a sandboxed iframe; every text from a run or GitHub goes in
 * as text, never as markup. A permission or a question the run waits for is a card of its own, answered from here.
 */
import { valueOf, type ViewHost } from "../shared/app";
import { permissionCard, questionCard } from "../shared/cards";
import { el, icon, ICONS, link } from "../shared/dom";

type Step = {
  node: string;
  attempt: number;
  status: string;
  state?: "queued" | "running" | "waiting";
  place?: number;
  waiting_on?: string;
  started_at: string | null;
  finished_at: string | null;
};

/** The fields of get_run's answer the card reads. */
export type RunCardData = {
  id: string;
  project?: string;
  graph?: string | null;
  task: string;
  status: string;
  url: string;
  pr: { number: number; url: string } | null;
  issues: { number: number; title: string; url: string }[];
  /** Missing from results saved before get_run reported it (2026-10-02); chats keep their old results. */
  cost_usd?: number;
  steps: Step[];
  questions?: { id: string; node?: string; question: string; options?: string[]; review_url?: string; try?: { url?: string } }[];
  permissions?: { id: string; node: string; asks: string; detail?: string | null; input?: unknown }[];
  failed?: { node: string; code: string | null; error: string | null } | null;
  stuck?: { node: string; attempts: number } | null;
};

const isRun = (value: unknown): value is RunCardData =>
  typeof value === "object" && value !== null && typeof (value as RunCardData).id === "string" && Array.isArray((value as RunCardData).steps);

/** The run in a get_run result, or the text to show instead. */
export function runOfResult(result: Parameters<typeof valueOf>[0]): { run: RunCardData } | { error: string } {
  const shown = valueOf(result, "get_run");
  if (!shown.ok) return { error: shown.error };
  return isRun(shown.value) ? { run: shown.value } : { error: "get_run returned no run." };
}

const TONES: Record<string, string> = {
  succeeded: "success",
  passed: "success",
  running: "active",
  waiting: "attention",
  sent_back: "attention",
  queued: "neutral",
  pending: "neutral",
  failed: "danger",
  cancelled: "muted",
  repaired: "repaired",
};
const toneOf = (status: string) => TONES[status] ?? "neutral";
const ACTIVE = new Set(["queued", "running", "waiting"]);

/** Each node once, at its latest attempt, in the order the run first reached it. */
function latestSteps(steps: Step[]) {
  const byNode = new Map<string, Step>();
  for (const step of steps) byNode.set(step.node, step);
  return [...byNode.values()];
}

const stepLabel = (step: Step) => {
  if (step.state === "waiting" || step.status === "waiting") return "waiting";
  if (step.state === "queued" || step.status === "pending") return "queued";
  return { passed: "done", sent_back: "sent back" }[step.status] ?? step.status.replaceAll("_", " ");
};
const STEP_CLASS: Record<string, string> = { done: "done", running: "run", waiting: "ask", "sent back": "ask", failed: "fail", repaired: "repaired" };

const WAITS_ON: Record<string, string> = {
  permission: "Waits for your permission",
  question: "Waits for your answer",
  ci: "Waits on CI for the pull request",
  merge_queue: "Waits in the merge queue",
  worker: "Waits for a worker to start it",
  overlap: "Waits for another run that changes the same files",
};

/**
 * What the run waits on or why it stopped, in one sentence, with its tone; null when it just runs or is done. The
 * permissions and questions it waits for follow as cards.
 */
function waitsOn(run: RunCardData): { text: string; tone: string } | null {
  if (run.failed) return { text: `Failed at ${run.failed.node}: ${run.failed.error ?? run.failed.code ?? "no reason given"}`, tone: "danger" };
  if (run.stuck) return { text: `Stuck at ${run.stuck.node}: its loop used all ${run.stuck.attempts} attempts.`, tone: "attention" };
  if (!ACTIVE.has(run.status)) return null;
  const waiting = run.steps.find((s) => s.state === "waiting" && s.waiting_on);
  if (waiting?.waiting_on) return { text: WAITS_ON[waiting.waiting_on] ?? `Waits on ${waiting.waiting_on.replaceAll("_", " ")}`, tone: "attention" };
  // A place in the worker's line matters only while nothing of the run is running.
  const queued = run.steps.some((s) => s.state === "running") ? undefined : run.steps.find((s) => s.state === "queued" && s.place);
  if (queued?.place) return { text: queued.place === 1 ? `${queued.node} starts next.` : `${queued.node} is number ${queued.place} in line.`, tone: "neutral" };
  return null;
}

/** How long the run has gone: from its first step's start to its last step's end, or to now while it is active. */
function duration(run: RunCardData, now: number) {
  const starts = run.steps.flatMap((s) => (s.started_at ? [Date.parse(s.started_at)] : []));
  if (!starts.length) return null;
  const ends = run.steps.flatMap((s) => (s.finished_at ? [Date.parse(s.finished_at)] : []));
  const end = ACTIVE.has(run.status) || !ends.length ? now : Math.max(...ends);
  const minutes = Math.max(0, Math.round((end - Math.min(...starts)) / 60_000));
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

/** The meta line: its parts with a dot between each two, which screen readers skip. */
function meta(parts: (HTMLElement | null)[]) {
  const line = el("div", "rc-m");
  for (const part of parts.filter((p): p is HTMLElement => p !== null)) {
    if (line.childElementCount) {
      const dot = el("span", undefined, "·");
      dot.setAttribute("aria-hidden", "true");
      line.append(dot);
    }
    line.append(part);
  }
  return line;
}

/** Draws the run card into `root`, replacing what was there. */
export function renderRunCard(root: HTMLElement, run: RunCardData, host: ViewHost = {}, now = Date.now()) {
  const { open } = host;
  const shortId = run.id.slice(0, 8);
  const tone = toneOf(run.status);
  const steps = latestSteps(run.steps);
  // The step the run is at: the one running, waiting or failed, else its latest.
  const current = [...run.steps].reverse().find((s) => s.state === "running" || s.state === "waiting" || ["running", "waiting", "failed"].includes(s.status)) ?? run.steps.at(-1);
  const [issue, ...moreIssues] = run.issues;
  const elapsed = duration(run, now);
  const waits = waitsOn(run);
  const cost = typeof run.cost_usd === "number" ? `$${run.cost_usd.toFixed(2)}${ACTIVE.has(run.status) ? " so far" : ""}` : undefined;
  const done = steps.filter((s) => s.status === "passed").length;

  const card = el(
    "section",
    "rc",
    el(
      "div",
      "rc-h",
      el("span", "k", icon(ICONS.play), "Run", el("span", "mono", shortId)),
      el("span", `pill t-${tone}`, el("span", "dot"), run.status.replaceAll("_", " ")),
      elapsed && el("span", "tm", elapsed),
    ),
    issue
      ? el("div", "rc-t", el("span", "n", `#${issue.number}`), link(issue.url, "ttl", open, issue.title), moreIssues.length > 0 && el("span", "more", `+${moreIssues.length} more`))
      : el("div", "rc-t", el("span", "ttl", run.task.trim() || "A run without a task")),
    issue && run.task.trim() && el("div", "rc-task", run.task.trim()),
    meta([run.graph ? el("span", "mono", run.graph) : null, current ? el("span", undefined, `attempt ${current.attempt}`) : null, cost ? el("span", undefined, cost) : null]),
  );
  card.setAttribute("aria-label", `Run ${shortId}`);

  if (steps.length) {
    const list = el("ol", "rc-s");
    list.setAttribute("aria-label", `Steps, ${done} of ${steps.length} done`);
    list.style.setProperty("--steps", String(steps.length));
    for (const step of steps) {
      const label = stepLabel(step);
      const item = el("li", `sp ${STEP_CLASS[label] ?? ""}`.trim(), el("span", "ln"), el("span", "nm", step.node));
      item.title = [step.node, label, step.attempt > 1 ? `attempt ${step.attempt}` : ""].filter(Boolean).join(", ");
      list.append(item);
    }
    card.append(list);
  }

  if (waits) card.append(el("p", `rc-w t-${waits.tone}`, waits.text));

  // What waits for the person, as the Inbox's cards: the permissions with the whole command, then the questions.
  const asks = [
    ...(run.permissions ?? []).map((p) => permissionCard({ ...p, url: run.url }, host)),
    ...(run.questions ?? []).map((q) => questionCard({ id: q.id, node: q.node, question: q.question, options: q.options ?? [], url: run.url, review_url: q.review_url, try_url: q.try?.url }, host)),
  ];
  if (asks.length) card.append(el("div", "rc-asks", ...asks));

  card.append(
    el(
      "div",
      "rc-f",
      link(run.url, "btn btn-outline", open, "Open run"),
      run.pr && link(run.pr.url, "btn", open, icon(ICONS.external), `PR #${run.pr.number}`),
      el("span", "src", "get_run"),
    ),
  );
  root.replaceChildren(card);
}
