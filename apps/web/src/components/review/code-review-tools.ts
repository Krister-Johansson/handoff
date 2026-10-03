"use client";

import type { DiffFile } from "@handoff/core";
import type { PageHandlers } from "@/lib/assistant/page-tools";
import { usePageTools } from "@/lib/assistant/use-page-tools";
import { CHOICES, CHOICE_TITLES, locationOf, type Choice, type Finding, type Findings, type FollowUp } from "@/lib/findings";
import { numberOn, type LineComment, type Side } from "@/lib/line-comments";
import type { useReviewDraft } from "@/lib/use-review-draft";
import type { ViewState } from "@/lib/viewed";
import { submitReviewTool } from "./send-review";

type Mode = "changes" | "whole";
type Layout = "unified" | "split";

/** The code of the selected lines on one side of a file, for the coder to find after lines move. */
export function quoteOf(file: DiffFile, side: Side, start: number, end: number) {
  return file.hunks
    .flatMap((h) => h.lines)
    .filter((l) => (side === "new" ? l.kind !== "del" : l.kind !== "add"))
    .filter((l) => {
      const n = numberOn(l, side);
      return n !== undefined && n >= start && n <= end;
    })
    .map((l) => l.text)
    .join("\n");
}

/** How a refusal lists the files a page tool can take. */
const fileList = (files: DiffFile[]) => `The files are: ${files.map((f, i) => `${i + 1}. ${f.path}`).join("; ")}.`;

/**
 * The file a page tool names, from 0: by its path or its index from 1. Throws a refusal that says
 * what there is to choose from.
 */
function findFile(files: DiffFile[], which: { path?: string | undefined; index?: number | undefined }): number {
  if (which.path !== undefined) {
    const at = files.findIndex((f) => f.path === which.path);
    if (at < 0) throw new Error(`${which.path} is not in this review. ${fileList(files)}`);
    return at;
  }
  if (which.index === undefined) throw new Error("Name the file by its path or its index.");
  if (which.index > files.length) throw new Error(`There is no file ${which.index}. The files run from 1 to ${files.length}.`);
  return which.index - 1;
}

/** The line numbers a file shows on one side, as runs of consecutive lines. */
function runsOn(file: DiffFile, side: Side) {
  const numbers = [...new Set(file.hunks.flatMap((h) => h.lines.flatMap((l) => numberOn(l, side) ?? [])))].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const n of numbers) {
    const last = runs.at(-1);
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  return runs;
}

const runsText = (runs: [number, number][]) => runs.map(([a, b]) => (a === b ? `${a}` : `${a} to ${b}`)).join(", ");

/**
 * The lines a page tool comments on, checked against what the file shows on that side; throws a
 * refusal that names the lines there are.
 */
function checkLines(file: DiffFile, side: Side, line: number, endLine: number) {
  const runs = runsOn(file, side);
  if (!runs.length) throw new Error(`${file.path} has no ${side} lines to comment on.`);
  if (endLine < line) throw new Error(`endLine ${endLine} comes before line ${line}.`);
  const missing = [line, endLine].find((n) => !runs.some(([a, b]) => n >= a && n <= b));
  if (missing === undefined) return;
  const range = runs.length === 1 ? `run from ${runs[0]![0]} to ${runs[0]![1]}` : `shown are ${runsText(runs)}`;
  throw new Error(`${file.path} has no ${side} line ${missing}. Its ${side} lines ${range}.`);
}

/** How a tool's answer names the lines of a comment. */
const linesText = (side: Side, line: number, endLine: number | undefined) =>
  `${side === "old" ? "old " : ""}${endLine !== undefined && endLine !== line ? `lines ${line} to ${endLine}` : `line ${line}`}`;
const commentCount = (n: number) => `${n} ${n === 1 ? "comment" : "comments"} drafted`;

/** What the code review page holds, for its page tools to read and change. */
type Review = {
  questionId: string;
  runId: string;
  from: string;
  files: DiffFile[];
  findings: (Findings & { by: string; followUp?: FollowUp | undefined }) | undefined;
  /** What the person does with each finding, and the Fix now ones the review sends back. */
  picks: { choices: Choice[]; choose: (index: number, choice: Choice) => void; fixNow: { index: number; finding: Finding }[] };
  readOnly: boolean;
  /** The drafted comments, or an answered review's sent ones. */
  comments: LineComment[];
  draft: ReturnType<typeof useReviewDraft<LineComment>>;
  view: {
    mode: Mode;
    setMode: (mode: Mode) => void;
    layout: Layout;
    setLayout: (layout: Layout) => void;
    closed: ReadonlySet<string>;
    setClosed: (closed: ReadonlySet<string>) => void;
    setOpen: (path: string, open: boolean) => void;
    /** The file the cursor is on, from 0. */
    current: number;
    go: (index: number) => void;
  };
  viewed: { stateOf: (file: DiffFile) => ViewState; mark: (file: DiffFile, viewed: boolean) => Promise<string | undefined> };
};

type Handlers = PageHandlers<"code_review">;

/** The tools that move around the review and change how it is shown: an answered review keeps these. */
function viewTools({ files, view }: Review): Pick<Handlers, "page_go_to_file" | "page_set_diff_view" | "page_expand_files"> {
  return {
    page_go_to_file: ({ path, index, direction }) => {
      if (!files.length) throw new Error("This review has no files.");
      const to = path === undefined && index === undefined ? view.current + (direction === "previous" ? -1 : 1) : findFile(files, { path, index });
      const at = Math.max(0, Math.min(files.length - 1, to));
      const named = `${at + 1} of ${files.length}: ${files[at]!.path}.`;
      if (at === view.current && to !== view.current) return `Already on the ${to < 0 ? "first" : "last"} file, ${named}`;
      view.setOpen(files[at]!.path, true);
      view.go(at);
      return `Now on file ${named}`;
    },
    page_set_diff_view: ({ mode, layout }) => {
      if (mode) view.setMode(mode);
      if (layout) view.setLayout(layout);
      const shown = (mode ?? view.mode) === "whole" ? "the whole file" : "the changes";
      return `Showing ${shown}, ${(layout ?? view.layout) === "split" ? "side by side" : "in one column"}.`;
    },
    page_expand_files: ({ all, path, open }) => {
      if (path !== undefined) {
        findFile(files, { path });
        view.setOpen(path, open !== false);
        return `${open === false ? "Collapsed" : "Expanded"} ${path}.`;
      }
      if (all === undefined) throw new Error("Say all, or a path with open.");
      view.setClosed(all ? new Set() : new Set(files.map((f) => f.path)));
      return all ? "Expanded every file." : "Collapsed every file.";
    },
  };
}

type DraftTools = Omit<Handlers, keyof ReturnType<typeof viewTools>>;

/** An answered review drafts nothing and sends nothing. */
const ANSWERED: DraftTools = {
  page_mark_viewed: undefined,
  page_comment_on_lines: undefined,
  page_remove_line_comment: undefined,
  page_set_note: undefined,
  page_set_finding_choice: undefined,
  page_submit_review: undefined,
};

/** How many findings have each choice, in words. */
const tallyText = (choices: Choice[]) => CHOICES.map(({ choice, title }) => `${title} ${choices.filter((c) => c === choice).length}`).join(", ");

/** The tools that change the person's drafts and marks, and send the review. */
function draftTools({ questionId, runId, from, files, findings, picks, comments, draft, view, viewed }: Review): DraftTools {
  return {
    page_mark_viewed: async ({ path, viewed: on }) => {
      const file = files[findFile(files, { path })]!;
      if (!file.blob) throw new Error(`${path} cannot be marked viewed: the review does not show its content.`);
      const error = await viewed.mark(file, on);
      if (error) throw new Error(error);
      view.setOpen(path, !on);
      const seen = files.filter((f) => (f.path === path ? on : viewed.stateOf(f).viewed)).length;
      return `Marked ${path} as ${on ? "viewed and collapsed" : "not viewed and expanded"} it. ${seen} of ${files.length} viewed.`;
    },
    page_comment_on_lines: ({ path, line, endLine, side = "new", body }) => {
      const file = files[findFile(files, { path })]!;
      checkLines(file, side, line, endLine ?? line);
      const comment: LineComment = { path, side, line, ...(endLine !== undefined && endLine !== line ? { endLine } : {}), quote: quoteOf(file, side, line, endLine ?? line), body };
      draft.setComments((list) => [...list, comment]);
      view.setOpen(path, true);
      return `Drafted a comment on ${linesText(side, line, comment.endLine)} of ${path}. ${commentCount(comments.length + 1)}.`;
    },
    page_remove_line_comment: ({ path, line }) => {
      const removed = comments.find((c) => c.path === path && c.line === line);
      if (!removed) {
        const drafted = comments.map((c) => `${c.path} ${linesText(c.side, c.line, c.endLine)}`);
        throw new Error(`No drafted comment starts at line ${line} of ${path}. ${drafted.length ? `The drafted comments are on: ${drafted.join("; ")}.` : "No comments are drafted."}`);
      }
      draft.setComments((list) => {
        const first = list.findIndex((c) => c.path === path && c.line === line);
        return list.filter((_, i) => i !== first);
      });
      return `Removed the comment on ${linesText(removed.side, removed.line, removed.endLine)} of ${path}. ${commentCount(comments.length - 1)}.`;
    },
    page_set_note: ({ note }) => {
      draft.setNote(note);
      return note.trim() ? `Set the overall comment to "${note}"` : "Cleared the overall comment.";
    },
    page_set_finding_choice: ({ index, choice }) => {
      const all = findings?.comments ?? [];
      if (!all.length) throw new Error("This review has no findings.");
      if (index > all.length) throw new Error(`There is no finding ${index}. The findings run from 1 to ${all.length}.`);
      if (findings?.followUp?.findings?.includes(index - 1)) throw new Error(`Finding ${index} is in follow-up issue #${findings.followUp.number}.`);
      picks.choose(index - 1, choice);
      const next = picks.choices.map((c, i) => (i === index - 1 ? choice : c));
      return `Set finding ${index}, ${locationOf(all[index - 1]!)}, to ${CHOICE_TITLES[choice]}. ${tallyText(next)}.`;
    },
    page_submit_review: ({ option }) =>
      submitReviewTool({
        questionId,
        runId,
        option,
        note: draft.note,
        comments,
        findings: findings?.comments.length ? picks.fixNow.map((f) => f.index).sort((a, b) => a - b) : undefined,
        target: from,
        onSending: draft.onSending,
        onFailed: draft.onFailed,
      }),
  };
}

/** The page's state for where_am_i: the files with the indices the tools take, the drafts, and the code reviewer's findings. */
function describe({ questionId, runId, from, files, findings, picks, readOnly, comments, draft, view, viewed }: Review) {
  return {
    questionId,
    runId,
    from,
    current: files.length ? view.current + 1 : null,
    mode: view.mode,
    layout: view.layout,
    files: files.map((f, i) => ({
      index: i + 1,
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      viewed: viewed.stateOf(f).viewed,
      open: !view.closed.has(f.path),
      comments: comments.filter((c) => c.path === f.path).length,
    })),
    comments,
    note: readOnly ? "" : draft.note,
    readOnly,
    ...(findings && {
      findings: {
        by: findings.by,
        verdict: findings.verdict,
        items: findings.comments.map((f, i) => ({ index: i + 1, severity: f.severity ?? "should_fix", path: f.path, ...(f.line !== undefined ? { line: f.line } : {}), body: f.body, choice: picks.choices[i] })),
        choicesNote: "fix_now findings go back to the coder with changes or fix; follow_up ones go into the follow-up issue; skip drops one. Later steps get only the fix_now findings as suggestions. page_set_finding_choice changes a choice.",
        followUp: findings.followUp ?? null,
        followUpNote: "The person opens a follow-up issue from the Follow-up findings with the Create follow-up issue button. No page tool does it.",
      },
    }),
  };
}

/**
 * Offers the code review's page tools to the assistant: moving between files and changing the view
 * always, and while the review is open, marking files viewed, drafting line comments, the overall
 * comment, choosing what to do with each finding and submitting.
 */
export function useCodeReviewTools(review: Review) {
  usePageTools("code_review", { ...viewTools(review), ...(review.readOnly ? ANSWERED : draftTools(review)) }, () => describe(review));
}
