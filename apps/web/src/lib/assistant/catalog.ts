import { z } from "zod";
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
};

const spec = <I extends z.ZodRawShape>(s: ToolSpec<I>) => s as unknown as ToolSpec;

const short = (id: unknown) => (typeof id === "string" ? id.slice(0, 8) : "?");
const project = z.string().describe("Project name or id");
const runId = z.string().describe("The run's id");

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
    description: "Adds a GitHub repository as a handoff project. Runs branch off its default branch; new projects have no graph until one is created on the project's Settings tab.",
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
    description: "A project's graphs, the graph new runs use by default, and its latest runs.",
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
    name: "list_runs",
    title: "List runs",
    description: "Runs, newest first, each with the step it is on and for how long. status active means queued, running or waiting.",
    input: z.object({ project: z.string().optional().describe("Project name"), status: z.enum(["active", "succeeded", "failed", "cancelled"]).optional() }),
    kind: "data",
    confirm: false,
    readOnly: true,
    summarize: (a) => `List ${a.status ?? ""} runs${a.project ? ` in ${a.project}` : ""}`.replace("  ", " "),
  }),
  spec({
    name: "get_run",
    title: "Show a run",
    description: "Where a run stands: status, steps with their start, end and duration, PR, linked issues, open questions and the failed step.",
    input: z.object({ run_id: runId }),
    kind: "data",
    confirm: false,
    readOnly: true,
    untrusted: true,
    summarize: (a) => `Show run ${short(a.run_id)}`,
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
      "Everything waiting on a person (questions from Human gates, failed runs, pull requests waiting for review), plus runs that reached a Finish node with notify on in the last day (kind finished).",
    input: z.object({}),
    kind: "data",
    confirm: false,
    readOnly: true,
    untrusted: true,
    summarize: () => "List what needs attention",
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
    title: "Dismiss a finished run",
    description: "Takes a finished run (an item of kind finished from list_attention) off the list once the user has seen it. Other items leave the list when someone acts on them.",
    input: z.object({ item_id: z.string().describe("The item's id from list_attention, finished:<run id>") }),
    kind: "data",
    confirm: false,
    readOnly: false,
    idempotent: true,
    summarize: (a) => `Dismiss ${a.item_id}`,
  }),
  spec({
    name: "answer_question",
    title: "Answer a question",
    description: "Answers a question a run asked, which lets it continue. Only answer with the user's decision.",
    input: z.object({
      question_id: z.string(),
      answer: z.string().min(1),
      option: z.string().optional().describe("One of the question's options, when it has them: approve or changes for a review"),
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
    }),
    kind: "data",
    confirm: true,
    readOnly: false,
    idempotent: false,
    summarize: (a) => `Answer the question${a.option ? ` with ${a.option}` : ""}: ${a.answer}`,
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
  }),
  spec({
    name: "repair_run",
    title: "Repair a run",
    description: "Re-runs the failed step of a failed run in place, keeping what earlier steps did. A note is passed to the step's agent.",
    input: z.object({ run_id: runId, node: z.string().optional().describe("The failed step; defaults to the one that failed last"), note: z.string().optional() }),
    kind: "data",
    confirm: true,
    readOnly: false,
    summarize: (a) => `Repair run ${short(a.run_id)}${a.node ? ` at ${a.node}` : ""}${a.note ? `: ${a.note}` : ""}`,
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
    description: "Starts a finished run's task again on the latest version of its graph.",
    input: z.object({ run_id: runId }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    summarize: (a) => `Run the task of run ${short(a.run_id)} again`,
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
      "The project's plan on GitHub Projects as a tree: epics with their stories with their tasks, each with its status (Shaping, Ready, Running, In review, Done), each task with its open blockers, latest run and pull request; plus issues the plan does not hold (unparented) and open issues outside it (unplanned). With epic, only that epic.",
    input: z.object({ project, epic: z.number().int().positive().optional().describe("Only this epic, by issue number") }),
    kind: "data",
    confirm: false,
    readOnly: true,
    untrusted: true,
    summarize: (a) => `Show the plan of ${a.project}${a.epic ? ` for epic #${a.epic}` : ""}`,
  }),
  spec({
    name: "list_github_projects",
    title: "List GitHub Projects",
    description:
      "The user's own GitHub Projects, those linked to the project's repository first, each with the Status options it lacks of Shaping, Ready, Running, In review and Done. Call it before setup_plan and ask the user whether to use one of them or create a new Project.",
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
      "Sets up a project's plan on GitHub Projects: the labels epic, story and task on the repository, and a GitHub Project of the user with the Status columns Shaping, Ready, Running, In review and Done, linked to the repository. Without use it creates a new Project; with use (a number from list_github_projects) it adopts that Project, renaming or adding Status options and keeping the others. Once a plan exists it creates nothing, re-creates missing labels and reports Status options the Project lacks.",
    input: z.object({ project, use: z.number().int().positive().optional().describe("An existing Project's number to use instead of creating one") }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    idempotent: true,
    summarize: (a) =>
      a.use
        ? `Use GitHub Project #${a.use} as the plan of ${a.project}: link it, give it the Status options Shaping, Ready, Running, In review and Done (renaming or adding the ones it lacks), and add the labels epic, story and task`
        : `Set up the plan of ${a.project} on GitHub: a new Project with the columns Shaping, Ready, Running, In review and Done, and the labels epic, story and task`,
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
    }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    idempotent: false,
    summarize: (a) => `Create story '${a.title}' under epic #${a.epic} in ${a.project}`,
  }),
  spec({
    name: "create_task",
    title: "Create a task",
    description:
      "Creates a task under a story of the project's plan: a sub-issue of the story labelled task, in Shaping. The brief is the body the agents read: the goal, where in the code, and how to tell it is done. blocked_by links issues that must close first. A task reaches the backlog once move_to_ready moves it to Ready.",
    input: z.object({
      project,
      story: z.number().int().positive().describe("The story's issue number"),
      title: z.string().min(3).describe("The task's title"),
      brief: z.string().min(1).describe("The goal, where in the code, and how to tell it is done"),
      acceptance: z.array(z.string().min(1)).optional().describe("Acceptance criteria, one sentence each"),
      blocked_by: z.array(z.number().int().positive()).optional().describe("Issue numbers this task waits on"),
    }),
    kind: "data",
    confirm: true,
    readOnly: false,
    openWorld: true,
    idempotent: false,
    summarize: (a) => `Create task '${a.title}' under story #${a.story} in ${a.project}${a.blocked_by?.length ? `, blocked by ${a.blocked_by.map((n) => `#${n}`).join(", ")}` : ""}`,
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
    title: "Open a project tab",
    description: "Opens a tab of a project's page. The issues tab filters by todo, started or all; the pulls tab by open, merged, closed, all or archived.",
    input: z.object({
      project_id: z.string().describe("The project's id from list_projects"),
      tab: z.enum(["runs", "issues", "pulls", "graphs", "settings"]),
      filter: z.string().optional(),
    }),
    kind: "ui",
    confirm: false,
    readOnly: true,
    summarize: (a) => `Open the ${a.tab} tab of project ${short(a.project_id)}${a.filter ? ` (${a.filter})` : ""}`,
  }),
  spec({
    name: "go_to_plan",
    title: "Open the plan",
    description:
      "Opens a project's Plan page: epics, stories and tasks from its GitHub Project, as a tree or a board, optionally narrowed to one epic (or the unplanned issues), some statuses, or tasks by their run.",
    input: z.object({
      project_id: z.string().describe("The project's id from list_projects"),
      view: z.enum(["tree", "board"]).optional(),
      epic: z.union([z.number().int().positive(), z.literal("unplanned")]).optional().describe("An epic's issue number, or unplanned"),
      status: z.array(z.enum(["Shaping", "Ready", "Running", "In review", "Done"])).optional(),
      run: z.enum(["any", "active", "needs-you", "none"]).optional().describe("Tasks with an active run, whose run needs the person, or with no run"),
    }),
    kind: "ui",
    confirm: false,
    readOnly: true,
    summarize: (a) => `Open the plan of project ${short(a.project_id)}${a.view === "board" ? " as a board" : ""}${a.epic !== undefined ? `, epic ${a.epic === "unplanned" ? "unplanned" : `#${a.epic}`}` : ""}`,
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
