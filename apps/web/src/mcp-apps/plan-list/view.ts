/**
 * The Plan list: list_plan's answer as the Plan page's tree (components/plan/plan-tree.tsx): epics with their
 * progress, their stories and tasks with status, blockers, latest run, pull request and size, and the moves handoff
 * owns. A Flow project shows each task's place in the order, its slot and its pin, and no dates; a Timeline project
 * shows Start and Target.
 */
import { act, say, statusLine } from "../shared/act";
import type { ViewHost } from "../shared/app";
import { button, el, link, plural, type Child } from "../shared/dom";

type Run = { id: string; status: string; url: string };
export type PlanTaskData = {
  number: number;
  title: string;
  status: string | null;
  state: string;
  url: string;
  blocked_by: number[];
  run: Run | null;
  pr: number | null;
  size: string | null;
  start?: string | null;
  target?: string | null;
  place?: number | null;
  lane?: number | null;
  pinned?: boolean;
  waits_for?: number[];
  after?: number | null;
  skipped?: string | null;
  progress?: { done: number; total: number } | null;
  parent?: number | null;
};
type Item = { number: number; title: string; status: string | null; state: string; url: string; start?: string | null; target?: string | null };
type Story = Item & { progress: string; tasks: PlanTaskData[] };
type Epic = Story & { stories: Story[] };
export type PlanData = {
  mode: "flow" | "timeline";
  project: { number: number; title: string; url: string };
  lanes?: number;
  order?: "project" | "priority";
  held?: string[];
  capacity_hours?: number | null;
  epics: Epic[];
  unparented: PlanTaskData[];
  unplanned: { number: number; title: string; url: string }[];
};

export const isPlan = (value: unknown): value is PlanData => typeof value === "object" && value !== null && Array.isArray((value as PlanData).epics) && typeof (value as PlanData).mode === "string";

/** What the view needs beside the plan: the host, and the project the tool was called with, if it named one. */
export type PlanContext = { host: ViewHost; project?: string | undefined };

/** The column a task sits in: a closed task is done whatever its Status says. */
const columnOf = (t: PlanTaskData) => (t.state === "closed" ? "Done" : (t.status ?? "Other"));
const TONE: Record<string, string> = { Shaping: "shaping", Ready: "ready", Running: "running", "In review": "review", Done: "done" };
const ACTIVE = new Set(["queued", "running", "waiting"]);
const hasActiveRun = (t: PlanTaskData) => t.run !== null && ACTIVE.has(t.run.status);

type Move = "ready" | "shaping";
/** The moves handoff owns as the task's status allows; a task its run still owns has none (lib/plan/task.ts). */
function movesOf(t: PlanTaskData): Move[] {
  if (hasActiveRun(t)) return [];
  const column = columnOf(t);
  if (column === "Shaping") return ["ready"];
  if (column === "Ready") return ["shaping"];
  if (column === "Done" && t.state === "open") return ["shaping", "ready"];
  return [];
}
const MOVE = {
  ready: { label: "Move to Ready", tool: "move_to_ready", status: "Ready", pending: (n: number) => `Moving #${n} to Ready…`, done: "Moved to Ready." },
  shaping: { label: "Back to Shaping", tool: "move_to_shaping", status: "Shaping", pending: (n: number) => `Moving #${n} back to Shaping…`, done: "Moved back to Shaping." },
} as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (date: string) => {
  const [, month, d] = date.split("-").map(Number);
  return `${MONTHS[(month ?? 1) - 1]} ${d}`;
};
/** Start and Target in words: "Oct 1 to Oct 9", "From Oct 1" or "By Oct 9". */
function dates(item: { start?: string | null; target?: string | null }) {
  const { start, target } = item;
  if (start && target) return `${day(start)} to ${day(target)}`;
  if (start) return `From ${day(start)}`;
  if (target) return `By ${day(target)}`;
  return undefined;
}

const tag = (text: string, className = "tag t-neutral") => el("span", className, text);

/** "#57 Add the migration", opening the issue on GitHub. */
const issueTitle = (item: { number: number; title: string; url: string }, ctx: PlanContext, className = "ttl") =>
  link(item.url, className, ctx.host.open, el("span", "n", `#${item.number}`), " ", item.title);

/** The progress of an epic or a story: a bar in the share done, and "3 of 8 done" beside it. */
function progress(text: string) {
  const [done = 0, total = 0] = (/^(\d+) of (\d+)/.exec(text) ?? []).slice(1).map(Number);
  const bar = el("span", "bar", el("span", "bar-in"));
  bar.setAttribute("aria-hidden", "true");
  (bar.firstChild as HTMLElement).style.width = `${total ? (done / total) * 100 : 0}%`;
  return el("span", "prog", bar, el("span", "muted", text));
}

/** The tags of a task: its place, slot and pin in a Flow, its blockers, and its dates in a Timeline. */
function taskTags(t: PlanTaskData, flow: boolean): Child[] {
  const done = columnOf(t) === "Done";
  return [
    flow && !!t.place && tag(`Next ${t.place}`),
    flow && !!t.lane && tag(`Slot ${t.lane}`),
    flow && t.pinned && tag("Pinned", "tag t-fill"),
    flow && t.progress && t.progress.total > 0 && tag(`${t.progress.done} of ${t.progress.total} steps`, "tag t-attention"),
    flow && !!t.after && tag(`After #${t.after}`, "tag t-fill"),
    ...(flow ? (t.waits_for ?? []).map((n) => tag(`Waits for #${n}`, "tag t-danger")) : []),
    flow && t.skipped && tag(`Skipped: ${t.skipped}`, "tag t-neutral dashed"),
    !done && t.blocked_by.length > 0 && tag(`Blocked by ${t.blocked_by.map((n) => `#${n}`).join(", ")}`, "tag t-fill"),
    !flow && dates(t) && el("span", "dates", dates(t)!),
    t.parent ? tag(`parent #${t.parent} is not in the plan`) : null,
  ];
}

/** The task's pull request on GitHub, next to its issue. */
const prUrl = (t: PlanTaskData) => t.url.replace(/\/issues\/\d+$/, `/pull/${t.pr}`);

/**
 * A row of the tree as an item named `label`: its line, indented by its depth, and the rows under it. The list
 * item holds both, so a task's item holds only its own line.
 */
function treeItem(label: string, depth: number, kind: string, line: Child[], children: HTMLElement[] = []) {
  const row = el("div", `row ${kind}`, ...line);
  row.style.setProperty("--depth", String(depth));
  const item = el("li", "node", row, children.length > 0 && el("ul", "rows", ...children));
  item.setAttribute("aria-label", label);
  return item;
}

function taskRow(t: PlanTaskData, depth: number, flow: boolean, ctx: PlanContext, said?: string): HTMLLIElement {
  const column = columnOf(t);
  const status = statusLine();
  if (said) say(status, said);
  const pill = el("span", `pill c-${TONE[column] ?? "other"}`, el("span", "dot"), column);
  const size = el("span", t.size ? "size" : "size none", t.size ?? "No size");
  const run = t.run && link(t.run.url, `pill run r-${t.run.status}`, ctx.host.open, t.run.status);
  const pr = t.pr !== null ? link(prUrl(t), "pr mono", ctx.host.open, `#${t.pr}`) : null;
  pr?.setAttribute("aria-label", `PR #${t.pr}`);
  const actions = el("span", "acts");
  const row = treeItem(`Task #${t.number} ${t.title}, ${column}`, depth, "task", [el("div", "row-l", pill, issueTitle(t, ctx), ...taskTags(t, flow)), el("div", "row-r", size, run, pr, actions), status]);
  const call = ctx.host.call;
  if (call) {
    const args = (extra: Record<string, unknown>) => ({ ...(ctx.project ? { project: ctx.project } : {}), ...extra });
    const redraw = (said: string) => row.replaceWith(taskRow(t, depth, flow, ctx, said));
    for (const move of movesOf(t)) {
      const m = MOVE[move];
      actions.append(
        button(m.label, move === "ready" && column === "Shaping" ? "btn btn-outline btn-xs" : "btn btn-ghost btn-xs", () =>
          void act(actions, status, m.pending(t.number), () => call(m.tool, args({ issues: [t.number] })), () => {
            t.status = m.status;
            t.state = "open";
            redraw(m.done);
          }),
        ),
      );
    }
    if (column === "Ready" && !hasActiveRun(t)) {
      const start = button("Start run", "btn btn-outline btn-xs", () =>
        void act(actions, status, `Starting a run on #${t.number}…`, () => call("start_run", args({ issues: [t.number] })), (value) => {
          const started = value as { run_id?: string; status?: string; url?: string } | null;
          if (started?.run_id && started.url) t.run = { id: started.run_id, status: started.status ?? "queued", url: started.url };
          redraw("Run started.");
        }),
      );
      if (t.blocked_by.length) {
        start.disabled = true;
        start.title = `Blocked by ${t.blocked_by.map((n) => `#${n}`).join(", ")} on GitHub; it can start once they are closed`;
      }
      actions.append(start);
    }
  }
  return row;
}

function headRow(kind: "Epic" | "Story", item: Item & { progress: string }, flow: boolean, ctx: PlanContext, children: HTMLElement[]) {
  const line = [
    el("div", "row-l", el("span", "kind", kind), issueTitle(item, ctx, kind === "Epic" ? "ttl strong" : "ttl"), !flow && dates(item) && el("span", "dates", dates(item)!)),
    el("div", "row-r", progress(item.progress)),
  ];
  return treeItem(`${kind} #${item.number} ${item.title}`, kind === "Epic" ? 0 : 1, kind.toLowerCase(), line, children);
}

/** A block of its own under a heading: an epic, Unparented or Unplanned. */
const block = (...rows: HTMLElement[]) => el("ul", "block", ...rows);

/** The Flow's line under the heading: how many runs it holds at once, its order, and why it is held. */
function flowLine(plan: PlanData) {
  return el(
    "div",
    "pl-flow",
    el("span", undefined, `${plural(plan.lanes ?? 1, "run")} at once · ${plan.order === "priority" ? "Priority order" : "Project order"}`),
    plan.held?.length ? el("span", "tag t-attention", `Held: ${plan.held.join("; ")}`) : null,
  );
}

/** The dashboard's Plan page of the project, from a run's address under it. */
export function planUrlOf(plan: PlanData): string | undefined {
  const tasks = [...plan.epics.flatMap((e) => [...e.stories.flatMap((s) => s.tasks), ...e.tasks]), ...plan.unparented];
  for (const t of tasks) {
    const match = t.run && /^(.*\/projects\/[^/]+)\/runs\//.exec(t.run.url);
    if (match) return `${match[1]}/plan`;
  }
  return undefined;
}

/** Draws the plan into `root`. `planUrl` is the dashboard's Plan page, when known. */
export function renderPlanList(root: HTMLElement, plan: PlanData, ctx: PlanContext, planUrl?: string) {
  const flow = plan.mode === "flow";
  const section = el(
    "section",
    "pl",
    el(
      "div",
      "pl-h",
      el("h2", undefined, "Plan"),
      link(plan.project.url, "proj", ctx.host.open, plan.project.title),
      el("span", "tag t-neutral", flow ? "Flow" : "Timeline"),
      !flow && plan.capacity_hours ? el("span", "muted", `${plan.capacity_hours} h a day`) : null,
    ),
    flow && flowLine(plan),
  );
  section.setAttribute("aria-label", "Plan");
  for (const epic of plan.epics) {
    section.append(
      block(
        headRow("Epic", epic, flow, ctx, [
          ...epic.stories.map((s) => headRow("Story", s, flow, ctx, s.tasks.map((t) => taskRow(t, 2, flow, ctx)))),
          ...epic.tasks.map((t) => taskRow(t, 1, flow, ctx)),
        ]),
      ),
    );
  }
  if (plan.unparented.length) {
    section.append(el("h3", "blk-h", "Unparented", el("span", "muted", "In the plan, with no epic or story of the plan above it.")), block(...plan.unparented.map((t) => taskRow(t, 0, flow, ctx))));
  }
  if (plan.unplanned.length) {
    const rows = plan.unplanned.map((i) => treeItem(`Issue #${i.number} ${i.title}`, 0, "issue", [el("div", "row-l", el("span", "kind", "Issue"), issueTitle(i, ctx))]));
    section.append(el("h3", "blk-h", "Unplanned", el("span", "muted", "Open issues outside the plan. They stay startable.")), block(...rows));
  }
  if (!plan.epics.length && !plan.unparented.length && !plan.unplanned.length) section.append(el("p", "state", "The plan has no epics yet."));
  section.append(
    el(
      "div",
      "foot",
      planUrl ? link(planUrl, "btn btn-outline", ctx.host.open, "Open in Plan") : link(plan.project.url, "btn btn-outline", ctx.host.open, "Open the Project on GitHub"),
      el("span", "src", "list_plan"),
    ),
  );
  root.replaceChildren(section);
}
