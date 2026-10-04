import { z } from "zod";
import { fillPlaces, placeMoves } from "../plan/flow-order";
import { pageToolSpec, type PageToolSpec } from "./page-tools";

/**
 * One tool of handoff's catalog. data tools run on the server (the agent MCP server, the assistant's
 * per-turn endpoint, the WebMCP route); ui tools run in the browser. A confirm tool waits for the
 * person to approve it before it runs.
 */
export type ToolSpec<I extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  /** A short title for tool and approval cards. */
  title: string;
  /** What the model or a browser agent reads to decide when to call it. */
  description: string;
  input: z.ZodObject<I>;
  kind: "data" | "ui";
  confirm: boolean;
  readOnly: boolean;
  /** Its result carries text from runs, issues or GitHub: data for the model, never instructions. */
  untrusted?: boolean;
  /** MCP hints beyond readOnly: whether it destroys or changes the outside world. */
  destructive?: boolean;
  openWorld?: boolean;
  idempotent?: boolean;
  /** One sentence for the approval card and the tool card. */
  summarize: (args: z.infer<z.ZodObject<I>>) => string;
  /**
   * The ui:// resource of its MCP Apps view, which draws its result: _meta.ui.resourceUri on /api/mcp, and the
   * card the assistant panel shows for the call.
   */
  view?: string;
};

/** The run card's ui:// resource: get_run's result drawn as a card. */
export const RUN_CARD_URI = "ui://handoff/run-card.html";
/** The Needs you list's: list_inbox's and list_attention's results in the Inbox's groups. */
export const NEEDS_YOU_URI = "ui://handoff/needs-you.html";
/** The permission card's: answer_permission's decision with the request it answers. */
export const PERMISSION_CARD_URI = "ui://handoff/permission-card.html";
/** The question card's: answer_question's answer with the question it answers. */
export const QUESTION_CARD_URI = "ui://handoff/question-card.html";
/** The Plan list's: list_plan's tree. */
export const PLAN_LIST_URI = "ui://handoff/plan-list.html";

const spec = <I extends z.ZodRawShape>(s: ToolSpec<I>) => s as unknown as ToolSpec;

const short = (id: unknown) => (typeof id === "string" ? id.slice(0, 8) : "?");
const project = z.string().describe("Project name or id");
const runId = z.string().describe("The run's id");
/** A calendar day, YYYY-MM-DD, as the Project's Start and Target fields hold it. */
const day = z.iso.date();

/** A schedule item's dates for an approval card: "Start 2026-10-06, Target 2026-10-09", "clear Start", or "no change". */
function datesText(dates: { start?: string | null | undefined; target?: string | null | undefined }) {
  const part = (name: string, value: string | null | undefined) => (value === undefined ? [] : [value === null ? `clear ${name}` : `${name} ${value}`]);
  const parts = [...part("Start", dates.start), ...part("Target", dates.target)];
  return parts.length ? parts.join(", ") : "no change";
}

type SizeOf = "S" | "M" | "L";
/** One set_size item: the new size and estimate (null clears, left out stays), and what list_plan showed before. */
type SizeItem = {
  issue: number;
  size?: SizeOf | null | undefined;
  estimate?: string | number | null | undefined;
  was?: { size?: SizeOf | null | undefined; estimate_hours?: number | null | undefined } | undefined;
};

/** A set_size item for an approval card: "#57 size M to L, estimate none to 3h", "#60 clear size". */
function sizeText(item: SizeItem) {
  const hours = (value: string | number | null | undefined) => (value === null || value === undefined ? "none" : typeof value === "number" ? `${value}h` : value);
  const part = (name: string, value: string | number | null | undefined, was: string | number | null | undefined, known: boolean) => {
    if (value === undefined) return [];
    const to = name === "size" ? (value ?? "none") : hours(value);
    if (known) return [`${name} ${name === "size" ? (was ?? "none") : hours(was)} to ${to}`];
    return [value === null ? `clear ${name}` : `${name} ${to}`];
  };
  const parts = [
    ...part("size", item.size, item.was?.size, item.was?.size !== undefined),
    ...part("estimate", item.estimate, item.was?.estimate_hours, item.was?.estimate_hours !== undefined),
  ];
  return `#${item.issue} ${parts.join(", ")}`;
}

/** set_order's arguments, as its approval card reads them. */
type OrderArgs = { project: string; order: number[]; pin?: number[] | undefined; unpin?: number[] | undefined; was?: number[] | undefined };

/**
 * set_order's approval sentence. With `was`, the order it read, each task that moves with its old and new place
 * and each pin change: "#74 Next 3 to Next 1, pinned; #61 stays Next 2, pinned". Without it, the new relative
 * order and the pin changes.
 */
function orderText(a: OrderArgs) {
  const pin = new Set(a.pin ?? []);
  const unpin = new Set(a.unpin ?? []);
  const mark = (n: number) => [...(pin.has(n) ? ["pinned"] : []), ...(unpin.has(n) ? ["unpinned"] : [])].map((m) => `, ${m}`).join("");
  if (!a.was) {
    const changes = [...(pin.size ? [`pin ${[...pin].map((n) => `#${n}`).join(", ")}`] : []), ...(unpin.size ? [`unpin ${[...unpin].map((n) => `#${n}`).join(", ")}`] : [])];
    return `Order in ${a.project}: ${a.order.map((n) => `#${n}`).join(", ")} in that order${changes.map((c) => `; ${c}`).join("")}`;
  }
  const after = fillPlaces(a.was, a.order);
  const moves = placeMoves(a.was, after);
  const moved = new Set(moves.map((m) => m.issue));
  const stays = [...new Set([...pin, ...unpin])].filter((n) => !moved.has(n));
  const placeOf = new Map(after.map((n, index) => [n, index + 1]));
  const parts = [
    ...moves.map((m) => `#${m.issue} Next ${m.from} to Next ${m.to}${mark(m.issue)}`),
    ...stays.map((n) => (placeOf.has(n) ? `#${n} stays Next ${placeOf.get(n)}${mark(n)}` : `#${n}${mark(n)}`)),
  ];
  return `Order in ${a.project}: ${parts.length ? parts.join("; ") : "no change"}`;
}

/**
 * start_scheduler's approval sentence: "Let handoff start up to 2 runs at a time on Ready tasks in
 * todooverkill, in Project order, with graph master". A setting left out keeps its stored value, or
 * its default the first time, and the sentence says so.
 */
function schedulerText(a: { project: string; max_runs?: number | undefined; order?: "project" | "priority" | undefined; graph?: string | undefined; skip_label?: string | null | undefined }) {
  const limit = a.max_runs ? `up to ${a.max_runs} ${a.max_runs === 1 ? "run" : "runs"} at a time` : "runs";
  const given = [
    ...(a.order ? [a.order === "priority" ? "by the Priority field" : "in Project order"] : []),
    ...(a.graph ? [`with graph ${a.graph}`] : []),
    ...(a.skip_label === undefined ? [] : [a.skip_label ? `skipping tasks labelled ${a.skip_label}` : "skipping no label"]),
  ];
  const defaults = [...(a.max_runs ? [] : ["1 run at a time"]), ...(a.order ? [] : ["Project order"]), ...(a.graph ? [] : ["the default graph"])];
  const rest = defaults.length === 0 ? "" : `, with its ${defaults.length === 3 ? "settings" : "other settings"} as they are (at first: ${defaults.join(", ")})`;
  return `Let handoff start ${limit} on Ready tasks in ${a.project}${given.map((g) => `, ${g}`).join("")}${rest}`;
}

/** Every tool handoff offers to an agent, once: the source of truth for MCP, the assistant and WebMCP. */
export const CATALOG: ToolSpec[] = [
  spec({
    name: "list_projects",
    title: "List projects",
    description: "The projects: each is a GitHub repository with graphs and runs.",
    input: z.object({}),
    kind: "data",
    confirm: false,
    readOnly: true,
    summarize: () => "List the projects",
  }),
  spec({
    name: "add_project",
    title: "Add a project",
    description: "Adds a GitHub repository as a handoff project. Runs branch off its default branch; new projects have no graph until one is created on the project's Graphs page.",
    input: z.object({
      repo: z.string().describe("owner/name on GitHub"),
      name: z.string().optional().describe("Project name; defaults to the repository's"),
      default_branch: z.string().optional().describe("Defaults to the repository's default branch"),
    }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    summarize: (a) => `Add ${a.repo} as a project${a.name ? ` named ${a.name}` : ""}`,
  }),
  spec({
    name: "get_project",
    title: "Show a project",
    description:
      "A project's graphs with their latest versions, the graph new runs use by default, its plan mode (flow: an order of tasks and their blockers, no dates; timeline: dates and estimates), and its latest runs with the graph version each runs on.",
    input: z.object({ project }),
    kind: "data",
    confirm: false,
    readOnly: true,
    summarize: (a) => `Show project ${a.project}`,
  }),
  spec({
    name: "setup_project",
    title: "Check a project's setup",
    description:
      "Checks whether a project is set up to work well with handoff: a graph, a running worker, a setup command, CLAUDE.md, an app that starts from .claude/launch.json for Demo and Try it, CI, acceptance criteria in issues, issue dependencies, webhooks and a plan on GitHub Projects. Each item says what was found and how to fix it.",
    input: z.object({ project }),
    kind: "data",
    confirm: false,
    readOnly: true,
    summarize: (a) => `Check the setup of ${a.project}`,
  }),
  spec({
    name: "list_backlog",
    title: "List the backlog",
    description: "The project's open GitHub issues that no run works on yet, newest activity first. With include_started, also issues a run already took.",
    input: z.object({ project, include_started: z.boolean().optional() }),
    kind: "data",
    confirm: false,
    readOnly: true,
    untrusted: true,
    summarize: (a) => `List the backlog of ${a.project}`,
  }),
  spec({
    name: "start_run",
    title: "Start a run",
    description: "Starts a run on the project. Link issues by number (their bodies go to the agents) and leave the task empty to use their titles, or describe a task.",
    input: z.object({
      project,
      issues: z.array(z.number().int().positive()).optional().describe("GitHub issue numbers the run works on"),
      task: z.string().optional().describe("What to do; defaults to the issues' titles"),
      graph: z.string().optional().describe("Graph name; defaults to the one the project's latest run used"),
    }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    summarize: (a) => `Start a run in ${a.project}${a.issues?.length ? ` on ${a.issues.map((n) => `#${n}`).join(", ")}` : a.task ? `: ${a.task}` : ""}`,
  }),
  spec({
    name: "assign",
    title: "Assign an issue",
    description:
      "Sets who is assigned an issue on GitHub, replacing its assignees: the logins given, plus the person handoff acts for (the GitHub user of its token) with me. An empty list without me clears the assignees. Use me when the person says they will work on an issue. Refuses a login the repository cannot assign, and then changes nothing. Does not change the plan's Status. start_run already assigns the person to an issue that has no assignee.",
    input: z.object({
      project,
      issue: z.number().int().positive().describe("The issue number"),
      logins: z.array(z.string().min(1)).describe("GitHub logins to assign; [] with me false clears the assignees"),
      me: z.boolean().optional().describe("Also assign the person handoff acts for"),
    }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    idempotent: true,
    summarize: (a) => {
      const who = [...a.logins, ...(a.me ? ["you"] : [])];
      return who.length ? `Assign #${a.issue} in ${a.project} to ${who.join(", ")}` : `Clear the assignees of #${a.issue} in ${a.project}`;
    },
  }),
  spec({
    name: "list_runs",
    title: "List runs",
    description: "Runs, newest first, each with the step it is on, for how long, and its state: queued with its place in line, running, or waiting with waiting_on (permission, question, ci, merge_queue, worker or overlap). status active means queued, running or waiting.",
    input: z.object({ project: z.string().optional().describe("Project name"), status: z.enum(["active", "succeeded", "failed", "cancelled"]).optional() }),
    kind: "data",
    confirm: false,
    readOnly: true,
    summarize: (a) => `List ${a.status ?? ""} runs${a.project ? ` in ${a.project}` : ""}`.replace("  ", " "),
  }),
  spec({
    name: "get_run",
    title: "Show a run",
    description:
      "Where a run stands: status, cost, steps with their state (queued with its place, running, or waiting on a permission, a question, CI, the merge queue or the worker), start, end, duration and cost, PR, linked issues, open questions (a Try it gate with its app, criteria and the demo's notes), pending permission prompts with the whole command, answered gates, the failed step with its code and Claude's last message, and a stuck loop's last review.",
    input: z.object({ run_id: runId }),
    kind: "data",
    confirm: false,
    readOnly: true,
    untrusted: true,
    summarize: (a) => `Show run ${short(a.run_id)}`,
    view: RUN_CARD_URI,
  }),
  spec({
    name: "get_run_events",
    title: "Show a run's events",
    description: "The latest events of a run, one line each, oldest first: steps starting and ending, tool calls, questions, pull request and merge updates. Secrets are redacted.",
    input: z.object({ run_id: runId, limit: z.number().int().positive().max(200).optional().describe("How many of the latest events; 50 when not given, at most 200") }),
    kind: "data",
    confirm: false,
    readOnly: true,
    untrusted: true,
    summarize: (a) => `Show the events of run ${short(a.run_id)}`,
  }),
  spec({
    name: "list_attention",
    title: "List what needs attention",
    description:
      "Everything waiting on a person (permission prompts, questions from Human gates, failed runs nobody dismissed, pull requests waiting for review), plus runs that reached a Finish node with notify on in the last day (kind finished).",
    input: z.object({}),
    kind: "data",
    confirm: false,
    readOnly: true,
    untrusted: true,
    summarize: () => "List what needs attention",
    view: NEEDS_YOU_URI,
  }),
  spec({
    name: "list_inbox",
    title: "Show the Inbox",
    description:
      "The Inbox, grouped by what the person must do: permission requests, reviews to open, questions to answer, pull requests ready to merge, runs that stopped (failed or stuck) and pull requests waiting for review. Each item has its dashboard path.",
    input: z.object({ project: z.string().optional().describe("Narrow to one project, by name or id") }),
    kind: "data",
    confirm: false,
    readOnly: true,
    untrusted: true,
    summarize: (a) => `Show the Inbox${a.project ? ` for ${a.project}` : ""}`,
    view: NEEDS_YOU_URI,
  }),
  spec({
    name: "list_notifications",
    title: "List notifications",
    description: "The notification feed, newest first, as the bell and the notifications page show it: each item's tone (neutral, success, attention or danger), title, body and link, and whether it is unread. What still waits for a person is in the inbox, not here.",
    input: z.object({
      filter: z.enum(["unread", "attention", "success", "danger"]).optional().describe("unread, attention (asked you), success (finished) or danger (failed)"),
      limit: z.number().int().positive().max(50).optional(),
    }),
    kind: "data",
    confirm: false,
    readOnly: true,
    untrusted: true,
    summarize: (a) => `List ${a.filter ?? "the latest"} notifications`,
  }),
  spec({
    name: "resolve_loop",
    title: "Decide a stuck loop",
    description:
      "Decides for a run stuck because a loop used all its attempts (get_run shows stuck): retry sends the work back for another round, continue goes on as if the step approved, stop cancels the run. Only with the user's decision.",
    input: z.object({ run_id: runId, action: z.enum(["retry", "continue", "stop"]) }),
    kind: "data",
    confirm: true,
    readOnly: false,
    destructive: true,
    idempotent: false,
    summarize: (a) => `${a.action === "retry" ? "Retry" : a.action === "continue" ? "Continue" : "Stop"} the stuck loop of run ${short(a.run_id)}`,
  }),
  spec({
    name: "dismiss_attention",
    title: "Dismiss a finished or failed run",
    description:
      "Takes a finished or failed run (an item of kind finished or failed from list_attention) off the list once the user has seen it. A failed run still waits for a repair in list_inbox. Questions and permission prompts leave the list when someone answers them.",
    input: z.object({ item_id: z.string().describe("The item's id from list_attention: finished:<run id>, failed:<step id> or stuck:<run id>") }),
    kind: "data",
    confirm: false,
    readOnly: false,
    idempotent: true,
    summarize: (a) => `Dismiss ${a.item_id}`,
  }),
  spec({
    name: "answer_question",
    title: "Answer a question",
    description:
      "Answers a question a run asked, which lets it continue. The option must be one the question lists (get_run shows them): approve, changes or fix (approve once the comments are fixed) for a review. At a code review with findings, changes and fix send the findings marked fix_now back to the coder unless findings names others. Later steps get only those findings as suggestions, with approve too. At a Try it gate, give criteria: a verdict for each acceptance criterion. Only answer with the user's decision.",
    input: z.object({
      question_id: z.string(),
      answer: z.string().min(1).optional().describe("The answer or note; required unless criteria answer a Try it gate"),
      option: z.string().optional().describe("One of the question's options, when it has them"),
      criteria: z
        .array(z.object({ criterion: z.string(), works: z.boolean(), note: z.string().optional().describe("What is wrong, when it does not work") }))
        .optional()
        .describe("For a Try it gate: whether each acceptance criterion works. Any that does not sends the work back with its note."),
      comments: z
        .array(
          z.object({
            quote: z.string().optional().describe("The passage or code the comment is about"),
            body: z.string(),
            path: z.string().optional().describe("For a code review: the file"),
            line: z.number().int().positive().optional().describe("For a code review: the first line, in the new file"),
            endLine: z.number().int().positive().optional().describe("For a code review: the last line, when the comment covers several"),
          }),
        )
        .optional()
        .describe("For a review: comments on quoted passages or on lines of files"),
      findings: z
        .array(z.number().int().positive())
        .optional()
        .describe("For a code review with findings: the findings to fix now, by index from 1 as get_run lists them. changes and fix send them back to the coder, and later steps get only them as suggestions. Without it, every finding marked fix_now (Blocking and Should fix); [] names none."),
    }),
    kind: "data",
    confirm: true,
    readOnly: false,
    idempotent: false,
    summarize: (a) =>
      a.criteria
        ? `Answer the Try it gate: ${a.criteria.filter((c) => !c.works).length} of ${a.criteria.length} criteria do not work`
        : `Answer the question${a.option ? ` with ${a.option}` : ""}: ${a.answer ?? ""}`,
    view: QUESTION_CARD_URI,
  }),
  spec({
    name: "answer_permission",
    title: "Answer a permission request",
    description:
      "Allows once or denies a tool call a step asked permission for (list_inbox shows them). Always allowing a rule is only possible in the dashboard. Only with the user's decision.",
    input: z.object({
      request_id: z.string().describe("The permission request's id"),
      decision: z.enum(["allow", "deny"]),
      message: z.string().optional().describe("For a denial: what to do instead, passed to the step's agent"),
    }),
    kind: "data",
    confirm: true,
    readOnly: false,
    idempotent: false,
    summarize: (a) => (a.decision === "allow" ? "Allow the permission request once" : `Deny the permission request${a.message ? `: ${a.message}` : ""}`),
    view: PERMISSION_CARD_URI,
  }),
  spec({
    name: "repair_run",
    title: "Repair a run",
    description:
      "Re-runs the failed step of a failed run in place, keeping what earlier steps did. A note is passed to the step's agent; allow_paths lets the step change those files outside the plan for the rest of the run.",
    input: z.object({
      run_id: runId,
      node: z.string().optional().describe("The failed step; defaults to the one that failed last"),
      note: z.string().optional(),
      allow_paths: z.array(z.string()).optional().describe("Files outside the plan the step may change, with the user's agreement"),
    }),
    kind: "data",
    confirm: true,
    readOnly: false,
    summarize: (a) =>
      `Repair run ${short(a.run_id)}${a.node ? ` at ${a.node}` : ""}${a.allow_paths?.length ? `, allowing ${a.allow_paths.join(", ")}` : ""}${a.note ? `: ${a.note}` : ""}`,
  }),
  spec({
    name: "list_merge_queue",
    title: "Show the merge queue",
    description:
      "A project's pull requests that are ready to merge, in the order they will merge. Each merges only when it is first, after catching up with main; a manual one also needs a person to ask (request_merge).",
    input: z.object({ project }),
    kind: "data",
    confirm: false,
    readOnly: true,
    summarize: (a) => `Show the merge queue of ${a.project}`,
  }),
  spec({
    name: "request_merge",
    title: "Merge a pull request",
    description:
      "Asks to merge a run's pull request, or with project and all every one in the project's merge queue. They merge one at a time in queue order, each brought up to date with main first. Merging changes the repository: ask the user first.",
    input: z.object({ run_id: z.string().optional(), project: project.optional(), all: z.boolean().optional() }),
    kind: "data",
    confirm: true,
    readOnly: false,
    destructive: true,
    openWorld: true,
    summarize: (a) => (a.all ? `Merge every ready pull request in ${a.project}, in queue order` : `Merge the pull request of run ${short(a.run_id)}`),
  }),
  spec({
    name: "cancel_run",
    title: "Cancel a run",
    description: "Cancels a run. Ask the user first.",
    input: z.object({ run_id: runId, reason: z.string().optional() }),
    kind: "data",
    confirm: true,
    readOnly: false,
    destructive: true,
    summarize: (a) => `Cancel run ${short(a.run_id)}${a.reason ? `: ${a.reason}` : ""}`,
  }),
  spec({
    name: "run_again",
    title: "Run again",
    description:
      "Starts a finished run's task again on the latest version of its graph, after the same blocker check as start_run. The new run supersedes the old one, and a failed old run is cancelled.",
    input: z.object({
      run_id: runId,
      from: z
        .enum(["branch", "scratch"])
        .optional()
        .describe(
          "branch: the new branch starts at the old run's branch, and the planner gets the old plan, decisions and open review findings. scratch: a new branch from the default branch with only the task. Defaults to branch when the old run committed work, else scratch.",
        ),
    }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    summarize: (a) => `Run the task of run ${short(a.run_id)} again${a.from === "scratch" ? " from scratch" : a.from === "branch" ? " from its branch" : ""}`,
  }),
  spec({
    name: "list_library",
    title: "List the library",
    description: "Skills, MCP servers, agents and groups nodes can enable by name.",
    input: z.object({}),
    kind: "data",
    confirm: false,
    readOnly: true,
    summarize: () => "List the library",
  }),
  spec({
    name: "list_plan",
    title: "Show the plan",
    description:
      "The project's plan on GitHub Projects as a tree: epics with their stories with their tasks, each with its status (Shaping, Ready, Running, In review, Done), each task with its open blockers, latest run and pull request, its Size (S, M or L) and the size its planner proposed; plus issues the plan does not hold (unparented) and open issues outside it (unplanned). mode says how the project plans. In Timeline mode each item has its Start and Target dates, each task its Estimate in hours and its duration in hours with where it comes from, with the project's capacity in hours a day and each size's forecast from its finished runs. In Flow mode there are no dates or hours: queue is the order the scheduler starts tasks in (Ready tasks, then Shaping tasks), lanes is how many runs it holds at once, held says why it waits, and each task has its place in the queue, its lane, whether it is pinned, waits_for (blockers it is placed before or that are outside the order), after (the blocker its lane waits for), skipped (why the scheduler passes it over) and, while it runs, progress in graph steps and waits_on. With epic, only that epic.",
    input: z.object({ project, epic: z.number().int().positive().optional().describe("Only this epic, by issue number") }),
    kind: "data",
    confirm: false,
    readOnly: true,
    untrusted: true,
    summarize: (a) => `Show the plan of ${a.project}${a.epic ? ` for epic #${a.epic}` : ""}`,
    view: PLAN_LIST_URI,
  }),
  spec({
    name: "list_github_projects",
    title: "List GitHub Projects",
    description:
      "The GitHub Projects of the repository's owner, a user or an organization, that the token can write, those linked to the project's repository first, each with the Status options it lacks of Shaping, Ready, Running, In review and Done. Call it before setup_plan and ask the user whether to use one of them or create a new Project.",
    input: z.object({ project }),
    kind: "data",
    confirm: false,
    readOnly: true,
    untrusted: true,
    summarize: (a) => `List the GitHub Projects for ${a.project}`,
  }),
  spec({
    name: "setup_plan",
    title: "Set up the plan",
    description:
      "Sets up a project's plan on GitHub Projects: the labels epic, story and task on the repository, and a GitHub Project of the repository's owner, a user or an organization, with the Status columns Shaping, Ready, Running, In review and Done and a single select Size with S, M and L, linked to the repository; in Timeline mode also the date fields Start and Target and a Number field Estimate, which a Flow project does not use. Without use it creates a new Project; with use (a number from list_github_projects) it adopts that Project, renaming or adding Status options and keeping the others. Once a plan exists it re-creates missing labels and fields (adding S, M and L to a Size field that lacks them) and reports Status options the Project lacks. The result's project names the Project's owner: its login and whether it is a User or an Organization.",
    input: z.object({ project, use: z.number().int().positive().optional().describe("An existing Project's number to use instead of creating one") }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    idempotent: true,
    summarize: (a) =>
      a.use
        ? `Use GitHub Project #${a.use} as the plan of ${a.project}: link it, give it the Status options Shaping, Ready, Running, In review and Done (renaming or adding the ones it lacks) and the field Size (in Timeline mode also Start, Target and Estimate), and add the labels epic, story and task`
        : `Set up the plan of ${a.project} on GitHub: a new Project with the columns Shaping, Ready, Running, In review and Done and the field Size (in Timeline mode also Start, Target and Estimate), and the labels epic, story and task`,
  }),
  spec({
    name: "create_epic",
    title: "Create an epic",
    description: "Creates an epic on the project's plan: an issue labelled epic whose body is its goal, in Shaping on the GitHub Project. Stories go under it with create_story.",
    input: z.object({ project, title: z.string().min(3).describe("The epic's title"), goal: z.string().min(1).describe("What the epic achieves, in a few sentences") }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    idempotent: false,
    summarize: (a) => `Create epic '${a.title}' in ${a.project}`,
  }),
  spec({
    name: "create_story",
    title: "Create a story",
    description:
      "Creates a story under an epic of the project's plan: a sub-issue of the epic labelled story whose body lists its acceptance criteria as checkboxes, in Shaping. Tasks go under it with create_task.",
    input: z.object({
      project,
      epic: z.number().int().positive().describe("The epic's issue number"),
      title: z.string().min(3).describe("The story's title"),
      acceptance: z.array(z.string().min(1)).min(1).describe("Acceptance criteria, one sentence each"),
      start: day.optional().describe("Start, YYYY-MM-DD, only in a Timeline project when the person gave dates"),
      target: day.optional().describe("Target, YYYY-MM-DD, only in a Timeline project when the person gave dates"),
    }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    idempotent: false,
    summarize: (a) => `Create story '${a.title}' under epic #${a.epic} in ${a.project}${a.start || a.target ? `, ${datesText(a)}` : ""}`,
  }),
  spec({
    name: "create_task",
    title: "Create a task",
    description:
      "Creates a task under a story of the project's plan: a sub-issue of the story labelled task, in Shaping. The brief is the body the agents read: the goal, where in the code, and how to tell it is done. blocked_by links issues that must close first. A task reaches the backlog once move_to_ready moves it to Ready. A Flow project refuses start and target: set_order places the task in the order instead.",
    input: z.object({
      project,
      story: z.number().int().positive().describe("The story's issue number"),
      title: z.string().min(3).describe("The task's title"),
      brief: z.string().min(1).describe("The goal, where in the code, and how to tell it is done"),
      acceptance: z.array(z.string().min(1)).optional().describe("Acceptance criteria, one sentence each"),
      blocked_by: z.array(z.number().int().positive()).optional().describe("Issue numbers this task waits on"),
      start: day.optional().describe("Start, YYYY-MM-DD, only in a Timeline project when the person gave dates"),
      target: day.optional().describe("Target, YYYY-MM-DD, only in a Timeline project when the person gave dates"),
      size: z.enum(["S", "M", "L"]).optional().describe("S, M or L, when the person sized the task"),
    }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    idempotent: false,
    summarize: (a) =>
      `Create task '${a.title}' under story #${a.story} in ${a.project}${a.blocked_by?.length ? `, blocked by ${a.blocked_by.map((n) => `#${n}`).join(", ")}` : ""}${a.start || a.target ? `, ${datesText(a)}` : ""}${a.size ? `, size ${a.size}` : ""}`,
  }),
  spec({
    name: "move_to_ready",
    title: "Move tasks to Ready",
    description:
      "Moves shaped tasks of the project's plan to Ready, which lets them into the backlog where runs start. Only tasks: refuses an epic, a story, a closed issue, a task without a body and an issue outside the plan, and then moves none of them.",
    input: z.object({ project, issues: z.array(z.number().int().positive()).min(1).describe("The tasks' issue numbers") }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    idempotent: true,
    summarize: (a) => `Move task${a.issues.length === 1 ? "" : "s"} ${a.issues.map((n) => `#${n}`).join(", ")} to Ready in ${a.project}`,
  }),
  spec({
    name: "move_to_shaping",
    title: "Move tasks back to Shaping",
    description:
      "Moves tasks of the project's plan back to Shaping, out of the backlog, to shape them further. Refuses a task an active run works on (cancel the run first), a closed issue and an issue that is not a task of the plan, and then moves none of them.",
    input: z.object({ project, issues: z.array(z.number().int().positive()).min(1).describe("The tasks' issue numbers") }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    idempotent: true,
    summarize: (a) => `Move task${a.issues.length === 1 ? "" : "s"} ${a.issues.map((n) => `#${n}`).join(", ")} back to Shaping in ${a.project}`,
  }),
  spec({
    name: "schedule",
    title: "Schedule plan items",
    description:
      "Sets, moves or clears the Start and Target dates of epics, stories and tasks of the project's plan on its GitHub Project, each item with its own dates, so one call can lay out a story's tasks one after another (work out the order from the blocked-by links in list_plan). A date is YYYY-MM-DD, null clears it and a date left out stays. Refuses a Target before its Start, an issue outside the plan and a Project without the Start and Target fields (setup_plan adds them), and then changes nothing. Propose dates only when the person asks to plan the timeline. Only for a Timeline project: a Flow project has no dates and refuses it; order its tasks with arrange_plan and set_order.",
    input: z.object({
      project,
      items: z
        .array(
          z.object({
            issue: z.number().int().positive().describe("The issue number of an epic, a story or a task"),
            start: day.nullable().optional().describe("Start, YYYY-MM-DD; null clears it"),
            target: day.nullable().optional().describe("Target, YYYY-MM-DD; null clears it"),
          }),
        )
        .min(1),
    }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    idempotent: true,
    summarize: (a) => `Schedule in ${a.project}: ${a.items.map((i) => `#${i.issue} ${datesText(i)}`).join("; ")}`,
  }),
  spec({
    name: "set_size",
    title: "Size tasks",
    description:
      "Sets or clears the Size (S, M or L) and the manual Estimate of tasks of the project's plan on its GitHub Project. An estimate is hours or days, like 3h or 2d (a day is the project's capacity in hours, which list_plan gives), or a number of hours; it overrides the size's forecast, and 0 or null clears it. A task with a Start gets the Target its new duration ends on. Give was with the size and estimate list_plan shows now, so the approval card names old and new values. Refuses an epic or a story (they sum their tasks), an issue outside the plan, an estimate it cannot read and a Project without the Size and Estimate fields (setup_plan adds them), and then changes nothing. Size tasks when the person sizes them. A Flow project has no hours: it takes sizes only, refuses an estimate and changes no date.",
    input: z.object({
      project,
      items: z
        .array(
          z
            .object({
              issue: z.number().int().positive().describe("The task's issue number"),
              size: z.enum(["S", "M", "L"]).nullable().optional().describe("S, M or L; null clears it"),
              estimate: z.union([z.string(), z.number().min(0)]).nullable().optional().describe("Hours or days, like 3h or 2d, or a number of hours; 0 or null clears it"),
              was: z
                .object({ size: z.enum(["S", "M", "L"]).nullable().optional(), estimate_hours: z.number().nullable().optional() })
                .optional()
                .describe("The task's size and estimate_hours as list_plan shows them now, for the approval card"),
            })
            .refine((i) => i.size !== undefined || i.estimate !== undefined, { error: "Give a size, an estimate or both." }),
        )
        .min(1),
    }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    idempotent: true,
    summarize: (a) => `Size in ${a.project}: ${a.items.map(sizeText).join("; ")}`,
  }),
  spec({
    name: "arrange_plan",
    title: "Arrange the plan",
    description:
      "A preview that writes nothing, by the project's plan mode. In a Flow project it is the Plan page's Optimize: the order of the queue for the earliest finish on the scheduler's lanes (blockers first, then the longest chain, the most work unblocked, Priority and the larger size), with pinned tasks and tasks outside the scope kept in their places. It returns was (the order now), the moves with each task's old and new place, the pinned tasks it kept, the new queue with each task's lane, and the tasks still placed before a blocker; propose it with one set_order call, giving was. It never pins or unpins. In a Timeline project it is Arrange by estimate: the unscheduled tasks laid out by their size or estimate from today, in blocked-by order, filling each day up to the project's capacity after the work already planned, a task never before its blockers end; each placed task has its Start, Target and hours, and tasks without a size or an estimate are left out with the reason; propose the dates with schedule, one call, when the person asks to plan the timeline. With epic, story or issues (epics, stories or tasks), only the tasks inside them are arranged, while every other task still counts.",
    input: z.object({
      project,
      epic: z.number().int().positive().optional().describe("Only this epic's tasks, by issue number"),
      story: z.number().int().positive().optional().describe("Only this story's tasks, by issue number"),
      issues: z.array(z.number().int().positive()).optional().describe("Only these epics, stories and tasks, and the tasks inside them"),
    }),
    kind: "data",
    confirm: false,
    readOnly: true,
    untrusted: true,
    summarize: (a) => {
      const scope = [...(a.epic ? [`epic #${a.epic}`] : []), ...(a.story ? [`story #${a.story}`] : []), ...(a.issues?.length ? [a.issues.map((n) => `#${n}`).join(", ")] : [])];
      return `Arrange the plan of ${a.project}${scope.length ? ` for ${scope.join(" and ")}` : ""}`;
    },
  }),
  spec({
    name: "set_order",
    title: "Set the order",
    description:
      "Writes a new order of a Flow project's tasks to Project order on GitHub, the order the scheduler starts Ready tasks in. order lists tasks of the queue (list_plan's queue) in their new order; they fill the places they hold now, and every other task keeps its place. Give was with the queue as list_plan or arrange_plan returned it, so the approval card names old and new places and a queue that changed since is refused. pin pins tasks at their new place, only when the person asks for a task's place to stay; unpin removes pins. Refuses a Timeline project (use schedule), a scheduler that starts by Priority (switch it to Project order with start_scheduler first), a task outside the queue, a Shaping task in a Ready task's place (Shaping tasks follow every Ready task), and a pinned task that would move unless unpin names it, and then writes nothing. A task may be placed before its blocker: it then waits for it, and the result lists it.",
    input: z.object({
      project,
      order: z.array(z.number().int().positive()).min(1).describe("Tasks of the queue in their new order"),
      was: z.array(z.number().int().positive()).optional().describe("The queue as list_plan or arrange_plan returned it, for the approval card and to refuse a stale order"),
      pin: z.array(z.number().int().positive()).optional().describe("Tasks to pin at their new place, when the person asks for their place to stay"),
      unpin: z.array(z.number().int().positive()).optional().describe("Pinned tasks to unpin, which lets them move"),
    }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    idempotent: true,
    summarize: (a) => orderText(a),
  }),
  spec({
    name: "plan_issue",
    title: "Plan an issue",
    description:
      "Brings an open issue of the project's repository that is not in the plan (list_plan lists them as unplanned) into the plan as a task in Shaping: the task label, and a sub-issue of the story when one is given.",
    input: z.object({
      project,
      issue: z.number().int().positive().describe("The issue's number"),
      story: z.number().int().positive().optional().describe("The story to put it under"),
    }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    idempotent: false,
    summarize: (a) => `Plan #${a.issue} as a task${a.story ? ` under story #${a.story}` : ""} in ${a.project}`,
  }),
  spec({
    name: "get_scheduler",
    title: "Show the scheduler",
    description:
      "A project's scheduler: off, paused, held, idle or running; in priority order, which Priority field it reads; what holds it (failed runs, including a stuck loop, and permission requests), each with its link; active runs of max_runs and the worker's Claude slots; runs waiting before their coder because their plan shares paths with another run; the next tasks it will start and the Ready tasks it skips with the reason; and its recent events.",
    input: z.object({ project }),
    kind: "data",
    confirm: false,
    readOnly: true,
    untrusted: true,
    summarize: (a) => `Show the scheduler of ${a.project}`,
  }),
  spec({
    name: "start_scheduler",
    title: "Start the scheduler",
    description:
      "Turns on a project's scheduler, or resumes it after a pause, and changes the settings given. The scheduler starts runs on its own on the plan's Ready tasks without open blockers, in Project order or by Priority, until max_runs runs of the project are active, and starts nothing while a run failed or a permission request waits for a person. Priority comes from the Project's own Priority field; in an organization's repository whose Project has none, from the organization's Priority issue field. A run waiting on a question, a plan or code review, Try it or a pull request review does not stop it: that run stays active and counts toward max_runs. A person decides what is Ready. Refuses a project without a plan, priority order with neither Priority field, and missing access to GitHub Projects.",
    input: z.object({
      project,
      max_runs: z.number().int().min(1).max(10).optional().describe("The most runs of the project active at once, 1 to 10; 1 when first turned on"),
      order: z.enum(["project", "priority"]).optional().describe("project for Project order, priority for Priority first; project when first turned on"),
      graph: z.string().optional().describe("The graph its runs use; the project's default graph when first turned on"),
      skip_label: z.string().nullable().optional().describe("Tasks with this label are left to a person; null skips none; human when first turned on"),
    }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    summarize: (a) => schedulerText(a),
  }),
  spec({
    name: "pause_scheduler",
    title: "Pause the scheduler",
    description: "Pauses a project's scheduler: it starts no new runs until start_scheduler resumes it. Active runs go on.",
    input: z.object({ project, reason: z.string().optional().describe("Why, shown with the paused scheduler") }),
    kind: "data",
    confirm: false,
    readOnly: false,
    idempotent: true,
    summarize: (a) => `Pause the scheduler of ${a.project}${a.reason ? `: ${a.reason}` : ""}`,
  }),
  spec({
    name: "stop_scheduler",
    title: "Turn off the scheduler",
    description:
      "Turns off a project's scheduler: it starts no new runs and forgets a pause, and keeps its settings. Active runs go on. Turning it on again with start_scheduler starts it as the first time.",
    input: z.object({ project }),
    kind: "data",
    confirm: false,
    readOnly: false,
    idempotent: true,
    summarize: (a) => `Turn off the scheduler of ${a.project}`,
  }),
  spec({
    name: "go_to",
    title: "Open a page",
    description: "Opens a page of this dashboard in the person's browser: a path such as /projects/<id>/runs/<run id>, or a dashboard URL a tool returned.",
    input: z.object({ path: z.string().describe("A dashboard path, or a URL of this dashboard") }),
    kind: "ui",
    confirm: false,
    readOnly: true,
    summarize: (a) => `Open ${a.path}`,
  }),
  spec({
    name: "go_to_inbox",
    title: "Open the Inbox",
    description: "Opens the Inbox, optionally narrowed to one project.",
    input: z.object({ project_id: z.string().optional().describe("The project's id from list_projects") }),
    kind: "ui",
    confirm: false,
    readOnly: true,
    summarize: (a) => `Open the Inbox${a.project_id ? ` for project ${short(a.project_id)}` : ""}`,
  }),
  spec({
    name: "go_to_notifications",
    title: "Open notifications",
    description: "Opens the notifications page, optionally filtered.",
    input: z.object({ filter: z.enum(["unread", "attention", "success", "danger"]).optional().describe("unread, attention (asked you), success (finished) or danger (failed)") }),
    kind: "ui",
    confirm: false,
    readOnly: true,
    summarize: (a) => `Open ${a.filter ?? "the"} notifications`,
  }),
  spec({
    name: "set_project_tab",
    title: "Open a project page",
    description:
      "Opens one of a project's pages: runs, plan, issues, pull requests (pulls), graphs (the Graphs section of project settings) or project settings. The runs page filters by active (queued or running), waiting, failed or done (succeeded or cancelled), and lists every run without one; the issues page filters by todo, started or all; the pulls page by open, merged, closed, all or archived. The library is in the dashboard's Settings: go_to /settings?tab=skills, subagents, mcp or groups.",
    input: z.object({
      project_id: z.string().describe("The project's id from list_projects"),
      tab: z.enum(["runs", "plan", "issues", "pulls", "graphs", "settings"]),
      filter: z.string().optional(),
    }),
    kind: "ui",
    confirm: false,
    readOnly: true,
    summarize: (a) => `Open the ${a.tab} page of project ${short(a.project_id)}${a.filter ? ` (${a.filter})` : ""}`,
  }),
  spec({
    name: "go_to_plan",
    title: "Open the plan",
    description:
      "Opens a project's Plan page: epics, stories and tasks from its GitHub Project, in the view of its plan mode (flow in a Flow project, timeline in a Timeline project; get_project says which) unless view asks for the tree or the board, optionally narrowed to one epic (or the unplanned issues), some statuses, or tasks by their run. The timeline takes a zoom.",
    input: z.object({
      project_id: z.string().describe("The project's id from list_projects"),
      view: z.enum(["tree", "board", "flow", "timeline"]).optional(),
      zoom: z.enum(["days", "weeks", "months"]).optional().describe("The timeline's zoom: days at 96 px a day for dragging, weeks or months; it picks one from the dates when left out"),
      epic: z.union([z.number().int().positive(), z.literal("unplanned")]).optional().describe("An epic's issue number, or unplanned"),
      status: z.array(z.enum(["Shaping", "Ready", "Running", "In review", "Done"])).optional(),
      run: z.enum(["any", "active", "needs-you", "none"]).optional().describe("Tasks with an active run, whose run needs the person, or with no run"),
    }),
    kind: "ui",
    confirm: false,
    readOnly: true,
    summarize: (a) => `Open the plan of project ${short(a.project_id)}${a.view === "board" ? " as a board" : a.view === "timeline" ? " as a timeline" : a.view === "flow" ? " as a flow" : ""}${a.epic !== undefined ? `, epic ${a.epic === "unplanned" ? "unplanned" : `#${a.epic}`}` : ""}`,
  }),
  spec({
    name: "go_to_run",
    title: "Open a run",
    description: "Opens the page of a run in the person's browser.",
    input: z.object({ run_id: runId }),
    kind: "ui",
    confirm: false,
    readOnly: true,
    summarize: (a) => `Open run ${short(a.run_id)}`,
  }),
  spec({
    name: "go_to_review",
    title: "Open a review",
    description: "Opens the review page of a run's review question (list_inbox lists them).",
    input: z.object({ run_id: runId, question_id: z.string().describe("The review question's id") }),
    kind: "ui",
    confirm: false,
    readOnly: true,
    summarize: (a) => `Open the review of run ${short(a.run_id)}`,
  }),
  spec({
    name: "go_to_try_it",
    title: "Open Try it",
    description: "Opens the Try it page of a run's Try it question, where the person checks the run's app.",
    input: z.object({ run_id: runId, question_id: z.string().describe("The Try it question's id") }),
    kind: "ui",
    confirm: false,
    readOnly: true,
    summarize: (a) => `Open Try it for run ${short(a.run_id)}`,
  }),
  spec({
    name: "where_am_i",
    title: "Check the page",
    description:
      "The page the person is looking at: its path, title and heading, and on pages with their own tools, the page's tools and its state (steps, criteria, files or nodes with the keys and indices the tools take). Call it before talking about this page or using a page tool.",
    input: z.object({}),
    kind: "ui",
    confirm: false,
    readOnly: true,
    summarize: () => "Check which page is open",
  }),
];

const BY_NAME = new Map(CATALOG.map((t) => [t.name, t]));

/** A tool of the catalog, or a page's tool, by name; throws for an unknown one. */
export function toolSpec(name: string): ToolSpec | PageToolSpec {
  const found = BY_NAME.get(name) ?? pageToolSpec(name);
  if (!found) throw new Error(`There is no tool ${name}.`);
  return found;
}

/** The ui:// resource of a catalog tool's MCP Apps view, if it has one. */
export function viewOf(name: string): string | undefined {
  return BY_NAME.get(name)?.view;
}

/** The MCP annotations a tool's spec implies. */
export function annotationsOf(spec: ToolSpec | PageToolSpec) {
  return {
    title: spec.title,
    readOnlyHint: spec.readOnly,
    ...(spec.readOnly ? {} : { destructiveHint: spec.destructive ?? false }),
    ...(spec.idempotent !== undefined ? { idempotentHint: spec.idempotent } : {}),
    openWorldHint: spec.openWorld ?? false,
  };
}

/** The project of an assistant chat: tools that take a project use it when a call leaves the project out. */
export type ChatProject = { id: string; name: string };

/** The argument a tool takes the chat's project for: a required project (by name), or a UI tool's required project_id. An optional project stays a filter. */
function chatProjectArgument(spec: ToolSpec | PageToolSpec): "project" | "project_id" | undefined {
  const shape = spec.input.shape as Record<string, z.ZodType | undefined>;
  for (const key of ["project", "project_id"] as const) {
    const field = shape[key];
    if (field && !field.safeParse(undefined).success) return key;
  }
  return undefined;
}

/** A tool's description and input as a chat on `project` sees them: its project argument is optional and says what it uses. */
export function forChatProject(spec: ToolSpec | PageToolSpec, project: ChatProject | undefined): { description: string; inputSchema: z.ZodRawShape } {
  const key = project && chatProjectArgument(spec);
  const shape = spec.input.shape as Record<string, z.ZodType>;
  if (!key) return { description: spec.description, inputSchema: shape };
  return {
    description: `${spec.description} Without ${key}, it uses ${project.name}, this chat's project.`,
    inputSchema: { ...shape, [key]: shape[key]!.optional() },
  };
}

/** A call's arguments with the chat's project filled in where the call left out the project argument its tool needs. */
export function withChatProject(spec: ToolSpec | PageToolSpec, args: unknown, project: ChatProject | undefined): unknown {
  const key = project && chatProjectArgument(spec);
  if (!key || typeof args !== "object" || args === null || Array.isArray(args) || (args as Record<string, unknown>)[key] !== undefined) return args;
  return { ...args, [key]: key === "project" ? project.name : project.id };
}
