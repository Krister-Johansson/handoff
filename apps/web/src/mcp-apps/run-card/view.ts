/**
 * The run card: get_run's answer drawn as the assistant chat's run card (Claude Design, shell/ChatPanel). Plain DOM,
 * because the view is one HTML document a host loads in a sandboxed iframe; every text from a run or GitHub goes in
 * as text, never as markup.
 */

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
  cost_usd: number;
  steps: Step[];
  questions?: { question: string }[];
  permissions?: { asks: string; detail?: string | null }[];
  failed?: { node: string; code: string | null; error: string | null } | null;
  stuck?: { node: string; attempts: number } | null;
};

type ToolResult = { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean };

/** Opens a dashboard or GitHub address through the host; false when the host does not open links. */
export type OpenLink = (url: string) => Promise<boolean>;

const isRun = (value: unknown): value is RunCardData =>
  typeof value === "object" && value !== null && typeof (value as RunCardData).id === "string" && Array.isArray((value as RunCardData).steps);

/**
 * The run in a get_run result, or the text to show instead. The run is the JSON in the text block, which every
 * client gets; the dashboard's assistant wraps it as { source, data }.
 */
export function runOfResult(result: ToolResult): { run: RunCardData } | { error: string } {
  const text = result.content?.find((c) => c.type === "text")?.text ?? "";
  if (result.isError) return { error: text || "get_run failed." };
  if (isRun(result.structuredContent)) return { run: result.structuredContent };
  try {
    const value = JSON.parse(text) as unknown;
    const run = isRun(value) ? value : (value as { data?: unknown } | null)?.data;
    if (isRun(run)) return { run };
  } catch {
    // Not JSON: fall through to the text itself.
  }
  return { error: text || "get_run returned no run." };
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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, ...children: (Node | string | null | undefined | false)[]) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) if (child) node.append(child);
  return node;
}

/** An SVG icon from lucide's paths, drawn inline so the view loads nothing. */
function icon(paths: string[]) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) {
    svg.setAttribute(name, value);
  }
  for (const d of paths) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
const PLAY = ["M6 3l14 9-14 9V3z"];
const EXTERNAL = ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"];

/**
 * A link that opens in the person's browser. When the host opens links (ui/open-link), the click asks it to;
 * otherwise it is a plain link to a new tab.
 */
function link(href: string, className: string | undefined, open: OpenLink | undefined, ...children: (Node | string)[]) {
  const a = el("a", className, ...children);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  if (open) {
    a.addEventListener("click", (event) => {
      event.preventDefault();
      void open(href).then((opened) => {
        if (!opened) window.open(href, "_blank", "noopener");
      });
    });
  }
  return a;
}

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

/** What the run waits on or why it stopped, in one sentence, with its tone; null when it just runs or is done. */
function waitsOn(run: RunCardData): { text: string; tone: string } | null {
  if (run.failed) return { text: `Failed at ${run.failed.node}: ${run.failed.error ?? run.failed.code ?? "no reason given"}`, tone: "danger" };
  if (run.stuck) return { text: `Stuck at ${run.stuck.node}: its loop used all ${run.stuck.attempts} attempts.`, tone: "attention" };
  const permission = run.permissions?.[0];
  if (permission) return { text: `${WAITS_ON.permission}: ${[permission.asks, permission.detail].filter(Boolean).join(", ")}`, tone: "attention" };
  const question = run.questions?.[0];
  if (question) return { text: `${WAITS_ON.question}: ${question.question}`, tone: "attention" };
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
export function renderRunCard(root: HTMLElement, run: RunCardData, open?: OpenLink, now = Date.now()) {
  const shortId = run.id.slice(0, 8);
  const tone = toneOf(run.status);
  const steps = latestSteps(run.steps);
  // The step the run is at: the one running, waiting or failed, else its latest.
  const current = [...run.steps].reverse().find((s) => s.state === "running" || s.state === "waiting" || ["running", "waiting", "failed"].includes(s.status)) ?? run.steps.at(-1);
  const [issue, ...moreIssues] = run.issues;
  const elapsed = duration(run, now);
  const waits = waitsOn(run);
  const cost = `$${run.cost_usd.toFixed(2)}${ACTIVE.has(run.status) ? " so far" : ""}`;
  const done = steps.filter((s) => s.status === "passed").length;

  const card = el(
    "section",
    "rc",
    el(
      "div",
      "rc-h",
      el("span", "k", icon(PLAY), "Run", el("span", "mono", shortId)),
      el("span", `pill t-${tone}`, el("span", "dot"), run.status.replaceAll("_", " ")),
      elapsed && el("span", "tm", elapsed),
    ),
    issue
      ? el("div", "rc-t", el("span", "n", `#${issue.number}`), link(issue.url, "ttl", open, issue.title), moreIssues.length > 0 && el("span", "more", `+${moreIssues.length} more`))
      : el("div", "rc-t", el("span", "ttl", run.task.trim() || "A run without a task")),
    issue && run.task.trim() && el("div", "rc-task", run.task.trim()),
    meta([run.graph ? el("span", "mono", run.graph) : null, current ? el("span", undefined, `attempt ${current.attempt}`) : null, el("span", undefined, cost)]),
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

  card.append(
    el(
      "div",
      "rc-f",
      link(run.url, "btn btn-outline", open, "Open run"),
      run.pr && link(run.pr.url, "btn", open, icon(EXTERNAL), `PR #${run.pr.number}`),
      el("span", "src", "get_run"),
    ),
  );
  root.replaceChildren(card);
}

/** A line in place of the card: while the run loads, or the tool's error. */
export function renderState(root: HTMLElement, text: string, error = false) {
  const line = el("p", error ? "state err" : "state", text);
  if (error) line.setAttribute("role", "alert");
  root.replaceChildren(line);
}
