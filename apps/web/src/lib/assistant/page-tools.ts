import { NodeTypeSchema } from "@handoff/core";
import { z } from "zod";
import type { ToolSpec } from "./catalog";

/** The pages that offer their own tools while they are open. */
export const PAGE_KINDS = ["run", "try", "code_review", "plan_review", "graph_editor", "inbox"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/** Whether a tool name belongs to a page: every page tool, and no catalog tool, starts with page_. */
export const isPageToolName = (name: string) => name.startsWith("page_");

/**
 * A tool of the open page: it runs in the browser, against what the page holds now (its view, its
 * drafts), through the handler the page binds with usePageTools. Names start with page_.
 */
export type PageToolSpec<I extends z.ZodRawShape = z.ZodRawShape> = Omit<ToolSpec<I>, "kind"> & { kind: "page" };

/** A spec that keeps its name and input types, so a page's handlers can be typed from its specs. */
type TypedSpec<N extends string, I extends z.ZodRawShape> = PageToolSpec<I> & { name: N };
const spec = <const N extends string, I extends z.ZodRawShape>(s: Omit<PageToolSpec<I>, "kind" | "name"> & { name: N }): TypedSpec<N, I> => ({ ...s, kind: "page" });

const quoted = (text: string, max = 60) => (text.length > max ? `"${text.slice(0, max - 1)}…"` : `"${text}"`);
const lines = (a: { line: number; endLine?: number | undefined }) => (a.endLine && a.endLine !== a.line ? `lines ${a.line} to ${a.endLine}` : `line ${a.line}`);
const index = z.number().int().positive();

// Shared by several pages: the same name means the same title, input and approval rule everywhere.
const setNote = spec({
  name: "page_set_note",
  title: "Write the overall comment",
  description: "Replaces the page's overall comment, the text that goes with the answer when the person submits. An empty note clears it. Nothing is sent until the page is submitted.",
  input: z.object({ note: z.string() }),
  confirm: false,
  readOnly: false,
  summarize: (a) => (a.note.trim() ? `Set the overall comment to ${quoted(a.note)}` : "Clear the overall comment"),
});

const submitReview = spec({
  name: "page_submit_review",
  title: "Submit the review",
  description:
    "Submits the review with the drafted comments and the overall comment: changes requests changes, approve lets the work through, fix approves after the comments are fixed. changes and fix need a comment or an overall comment.",
  input: z.object({ option: z.enum(["changes", "approve", "fix"]) }),
  confirm: true,
  readOnly: false,
  summarize: (a) => (a.option === "approve" ? "Approve the review" : a.option === "fix" ? "Approve after fixes, sending the comments back" : "Request changes, sending the comments back"),
});

const TOOLS = {
  run: [
    spec({
      name: "page_show_view",
      title: "Show a view",
      description: "Shows one of the run page's views: steps (the list of steps), graph (the run drawn on its graph) or events (the run's event log).",
      input: z.object({ view: z.enum(["steps", "graph", "events"]) }),
      confirm: false,
      readOnly: true,
      summarize: (a) => `Show the ${a.view} view`,
    }),
    spec({
      name: "page_open_step",
      title: "Open a step",
      description: "Opens a step's drawer with its output: by node key (its latest attempt) or by execution id, and with attempt a given attempt. where_am_i lists the steps.",
      input: z.object({ step: z.string().describe("The step's node key or execution id"), attempt: index.optional().describe("Which attempt, from 1") }),
      confirm: false,
      readOnly: true,
      summarize: (a) => `Open step ${a.step}${a.attempt ? `, attempt ${a.attempt}` : ""}`,
    }),
    spec({
      name: "page_close_step",
      title: "Close the step",
      description: "Closes the open step's drawer, and its popped out window.",
      input: z.object({}),
      confirm: false,
      readOnly: true,
      summarize: () => "Close the step",
    }),
    spec({
      name: "page_pop_out",
      title: "Pop out the step",
      description: "Shows the open step in a large window (open true) or back in the drawer (open false). A step must be open first (page_open_step).",
      input: z.object({ open: z.boolean() }),
      confirm: false,
      readOnly: true,
      summarize: (a) => (a.open ? "Pop out the step" : "Put the step back in the drawer"),
    }),
    spec({
      name: "page_filter_events",
      title: "Filter the events",
      description: "Shows the events view narrowed to one node's events (node null shows all), and with cli the Claude CLI's own events too.",
      input: z.object({ node: z.string().nullable().optional().describe("A node key, or null for every node"), cli: z.boolean().optional() }),
      confirm: false,
      readOnly: true,
      summarize: (a) => `Show the events${a.node ? ` of ${a.node}` : ""}${a.cli ? " with the CLI's events" : ""}`,
    }),
  ],
  try: [
    spec({
      name: "page_mark_criterion",
      title: "Mark a criterion",
      description:
        "Marks an acceptance criterion as working (works true), not working (works false) or unchecked (works null), by its index from 1 or its text, with an optional note on what was seen. where_am_i lists the criteria.",
      input: z.object({
        index: index.optional().describe("The criterion's number, from 1"),
        criterion: z.string().optional().describe("The criterion's text, when no index is given"),
        works: z.boolean().nullable(),
        note: z.string().optional(),
      }),
      confirm: false,
      readOnly: false,
      summarize: (a) => {
        const which = a.index ? `criterion ${a.index}` : a.criterion ? quoted(a.criterion) : "the criterion";
        return a.works === null ? `Uncheck ${which}` : `Mark ${which} as ${a.works ? "working" : "not working"}`;
      },
    }),
    spec({
      name: "page_go_to_criterion",
      title: "Go to a criterion",
      description: "Moves the cursor to a criterion by its index from 1, or to the next or previous one.",
      input: z.object({ index: index.optional(), direction: z.enum(["next", "previous"]).optional() }),
      confirm: false,
      readOnly: true,
      summarize: (a) => (a.index ? `Go to criterion ${a.index}` : `Go to the ${a.direction ?? "next"} criterion`),
    }),
    setNote,
    spec({
      name: "page_submit",
      title: "Submit Try it",
      description:
        "Answers Try it: approve when every criterion works, or changes to send the run back to its coder with the criteria that do not work and the note. changes needs a criterion that does not work or a note.",
      input: z.object({ option: z.enum(["approve", "changes"]), note: z.string().optional() }),
      confirm: true,
      readOnly: false,
      summarize: (a) => (a.option === "approve" ? "Approve the app" : `Send the app back to the coder${a.note ? `: ${a.note}` : ""}`),
    }),
    spec({
      name: "page_restart_app",
      title: "Restart the app",
      description: "Restarts the run's app that Try it opens, from the run's branch.",
      input: z.object({}),
      confirm: true,
      readOnly: false,
      summarize: () => "Restart the app",
    }),
    spec({
      name: "page_expand_criteria",
      title: "Expand or collapse criteria",
      description: "Expands every criterion (all true) or collapses them all (all false).",
      input: z.object({ all: z.boolean() }),
      confirm: false,
      readOnly: true,
      summarize: (a) => (a.all ? "Expand every criterion" : "Collapse every criterion"),
    }),
  ],
  code_review: [
    spec({
      name: "page_go_to_file",
      title: "Go to a file",
      description: "Moves to a changed file by path, by index from 1, or to the next or previous one, and opens it. where_am_i lists the files.",
      input: z.object({ path: z.string().optional(), index: index.optional(), direction: z.enum(["next", "previous"]).optional() }),
      confirm: false,
      readOnly: true,
      summarize: (a) => (a.path ? `Go to ${a.path}` : a.index ? `Go to file ${a.index}` : `Go to the ${a.direction ?? "next"} file`),
    }),
    spec({
      name: "page_set_diff_view",
      title: "Change the diff view",
      description: "Shows only the changes or the whole file (mode), in one column or side by side (layout unified or split).",
      input: z.object({ mode: z.enum(["changes", "whole"]).optional(), layout: z.enum(["unified", "split"]).optional() }),
      confirm: false,
      readOnly: true,
      summarize: (a) => `Show ${[a.mode === "whole" ? "the whole file" : a.mode === "changes" ? "the changes" : undefined, a.layout === "split" ? "side by side" : a.layout === "unified" ? "in one column" : undefined].filter(Boolean).join(" ") || "the diff"}`,
    }),
    spec({
      name: "page_expand_files",
      title: "Expand or collapse files",
      description: "Expands or collapses every file (all), or one file by path (path with open).",
      input: z.object({ all: z.boolean().optional(), path: z.string().optional(), open: z.boolean().optional() }),
      confirm: false,
      readOnly: true,
      summarize: (a) => (a.path ? `${a.open === false ? "Collapse" : "Expand"} ${a.path}` : a.all === false ? "Collapse every file" : "Expand every file"),
    }),
    spec({
      name: "page_mark_viewed",
      title: "Mark a file viewed",
      description: "Marks a file as viewed (and collapses it) or not viewed, as the file's Viewed box does.",
      input: z.object({ path: z.string(), viewed: z.boolean() }),
      confirm: false,
      readOnly: false,
      idempotent: true,
      summarize: (a) => `Mark ${a.path} as ${a.viewed ? "viewed" : "not viewed"}`,
    }),
    spec({
      name: "page_comment_on_lines",
      title: "Comment on lines",
      description: "Drafts a comment on a line or a range of lines of a file, on the new side unless side is old. The draft is sent when the review is submitted.",
      input: z.object({
        path: z.string(),
        line: index,
        endLine: index.optional(),
        side: z.enum(["old", "new"]).optional(),
        body: z.string().min(1),
      }),
      confirm: false,
      readOnly: false,
      summarize: (a) => `Comment on ${lines(a)} of ${a.path}: ${a.body}`,
    }),
    spec({
      name: "page_remove_line_comment",
      title: "Remove a line comment",
      description: "Removes the drafted comment that starts at a line of a file.",
      input: z.object({ path: z.string(), line: index }),
      confirm: false,
      readOnly: false,
      summarize: (a) => `Remove the comment on line ${a.line} of ${a.path}`,
    }),
    setNote,
    submitReview,
  ],
  plan_review: [
    spec({
      name: "page_comment_on_passage",
      title: "Comment on a passage",
      description: "Drafts a comment on a passage of the plan, quoted exactly as the plan has it. The draft is sent when the review is submitted.",
      input: z.object({ quote: z.string().min(1), body: z.string().min(1) }),
      confirm: false,
      readOnly: false,
      summarize: (a) => `Comment on ${quoted(a.quote)}: ${a.body}`,
    }),
    spec({
      name: "page_remove_comment",
      title: "Remove a comment",
      description: "Removes the drafted comment on a quoted passage.",
      input: z.object({ quote: z.string() }),
      confirm: false,
      readOnly: false,
      summarize: (a) => `Remove the comment on ${quoted(a.quote)}`,
    }),
    setNote,
    submitReview,
  ],
  graph_editor: [
    spec({
      name: "page_select",
      title: "Select in the graph",
      description: "Selects a node by key or an edge by id, which shows it in the inspector; with neither, clears the selection.",
      input: z.object({ node: z.string().optional(), edge: z.string().optional() }),
      confirm: false,
      readOnly: true,
      summarize: (a) => (a.node ? `Select ${a.node}` : a.edge ? `Select edge ${a.edge}` : "Clear the selection"),
    }),
    spec({
      name: "page_get_node",
      title: "Read a node",
      description: "A node's label, type, settings, library, contract and notify settings as the inspector shows them, with its edges in and out.",
      input: z.object({ key: z.string() }),
      confirm: false,
      readOnly: true,
      untrusted: true,
      summarize: (a) => `Read node ${a.key}`,
    }),
    spec({
      name: "page_get_edge",
      title: "Read an edge",
      description: "An edge's condition, loop, attempts and exhausted settings as the inspector shows them.",
      input: z.object({ id: z.string() }),
      confirm: false,
      readOnly: true,
      untrusted: true,
      summarize: (a) => `Read edge ${a.id}`,
    }),
    spec({
      name: "page_update_node",
      title: "Change a node",
      description: "Changes a node's settings with the inspector's fields for its type (page_get_node shows them). The graph is not saved until page_save_graph.",
      input: z.object({ key: z.string(), patch: z.record(z.string(), z.unknown()).describe("The inspector's fields to change") }),
      confirm: false,
      readOnly: false,
      summarize: (a) => `Change ${Object.keys(a.patch).join(", ") || "nothing"} of ${a.key}`,
    }),
    spec({
      name: "page_rename_node",
      title: "Rename a node",
      description: "Changes a node's key; its edges follow. The graph is not saved until page_save_graph.",
      input: z.object({ key: z.string(), to: z.string() }),
      confirm: false,
      readOnly: false,
      summarize: (a) => `Rename ${a.key} to ${a.to}`,
    }),
    spec({
      name: "page_update_edge",
      title: "Change an edge",
      description: "Changes an edge's condition, loop, maxAttempts, onExhausted, on or priority. The graph is not saved until page_save_graph.",
      input: z.object({ id: z.string(), patch: z.record(z.string(), z.unknown()).describe("The edge's fields to change") }),
      confirm: false,
      readOnly: false,
      summarize: (a) => `Change ${Object.keys(a.patch).join(", ") || "nothing"} of edge ${a.id}`,
    }),
    spec({
      name: "page_add_node",
      title: "Add a node",
      description: "Adds a node of a type at a position, or in the middle of the view. The graph is not saved until page_save_graph.",
      input: z.object({ type: NodeTypeSchema, position: z.object({ x: z.number(), y: z.number() }).optional() }),
      confirm: false,
      readOnly: false,
      summarize: (a) => `Add a ${a.type} node`,
    }),
    spec({
      name: "page_connect",
      title: "Connect two nodes",
      description: "Adds an edge from one node to another, from a port of the source when it has several, if the graph's rules allow it.",
      input: z.object({ source: z.string(), target: z.string(), port: z.string().optional() }),
      confirm: false,
      readOnly: false,
      summarize: (a) => `Connect ${a.source}${a.port ? ` (${a.port})` : ""} to ${a.target}`,
    }),
    spec({
      name: "page_remove",
      title: "Remove from the graph",
      description: "Removes nodes by key and edges by id; a node's edges go with it. The graph is not saved until page_save_graph.",
      input: z.object({ ids: z.array(z.string()).min(1) }),
      confirm: false,
      readOnly: false,
      destructive: true,
      summarize: (a) => `Remove ${a.ids.join(", ")}`,
    }),
    spec({
      name: "page_tidy_layout",
      title: "Tidy the layout",
      description: "Lays the graph out again, left to right.",
      input: z.object({}),
      confirm: false,
      readOnly: false,
      summarize: () => "Tidy the layout",
    }),
    spec({
      name: "page_issues",
      title: "List the graph's issues",
      description: "What keeps the graph from being saved: missing settings, unreachable nodes, edges the rules forbid.",
      input: z.object({}),
      confirm: false,
      readOnly: true,
      summarize: () => "List the graph's issues",
    }),
    spec({
      name: "page_save_graph",
      title: "Save the graph",
      description: "Saves the edited graph as its next version, which new runs use. Refused while the graph has issues.",
      input: z.object({}),
      confirm: true,
      readOnly: false,
      summarize: () => "Save the graph as a new version",
    }),
  ],
  inbox: [
    spec({
      name: "page_show_item",
      title: "Show an Inbox item",
      description: "Scrolls an Inbox card into view and focuses it, by a question, permission, run or execution id from where_am_i.",
      input: z.object({ id: z.string() }),
      confirm: false,
      readOnly: true,
      summarize: (a) => `Show item ${a.id}`,
    }),
  ],
} satisfies Record<PageKind, unknown[]>;

/** Every page's tools, once: the source of truth for the turn's MCP server, where_am_i and WebMCP. */
export const PAGE_TOOLS = TOOLS as unknown as Record<PageKind, PageToolSpec[]>;

type ToolOf<K extends PageKind> = (typeof TOOLS)[K][number];

/**
 * The handlers a page binds: one key per tool of its kind, so none is forgotten and no other name is
 * accepted. A tool the page does not offer right now (a submit on an answered review) is undefined.
 */
export type PageHandlers<K extends PageKind> = {
  [T in ToolOf<K> as T["name"]]: ((args: z.infer<T["input"]>) => string | Promise<string>) | undefined;
};
