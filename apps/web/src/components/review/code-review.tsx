"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronsDownUpIcon, ChevronsUpDownIcon, FileCodeIcon, HistoryIcon } from "lucide-react";
import type { DiffFile } from "@handoff/core";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { markViewedAction } from "@/app/inbox/actions";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePageTools } from "@/lib/assistant/use-page-tools";
import { commentedAt, placeEarlier, type EarlierRound } from "@/lib/earlier";
import { placeFindings, type Findings, type FollowUp } from "@/lib/findings";
import type { LineTokens } from "@/lib/highlight-types";
import { numberOn, type LineComment, type LineSelection, type Side } from "@/lib/line-comments";
import { useReviewDraft } from "@/lib/use-review-draft";
import { cn } from "@/lib/utils";
import { viewState, type View, type ViewState } from "@/lib/viewed";
import { FileDiff } from "./file-diff";
import { FindingsSummary } from "./findings-summary";
import { CARD, PROSE, PROSE_TIGHT } from "./styles";
import { SubmitReview } from "./submit-review";

/** The design's segmented control: two or more choices in one soft well, the chosen one raised. */
const SEG = "rounded-md border bg-subtle p-0.5";
const SEG_ITEM = "h-6 min-w-0 rounded-[4px] px-2.5 text-xs text-muted-foreground hover:bg-transparent data-[state=on]:bg-secondary data-[state=on]:text-foreground";

type Mode = "changes" | "whole";
type Layout = "unified" | "split";

/** The code of the selected lines on one side of a file, for the coder to find after lines move. */
function quoteOf(file: DiffFile, side: Side, start: number, end: number) {
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

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Moves between files with prev and next, the [ and ] keys, and a list of every file. */
function useFileCursor(count: number) {
  const [current, setCurrent] = useState(0);
  const go = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(count - 1, index));
      setCurrent(next);
      document.getElementById(`review-file-${next}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    },
    [count],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "]") go(current + 1);
      if (e.key === "[") go(current - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, go]);
  return [current, go] as const;
}

function FileMenu({ files, current, go, viewed }: { files: DiffFile[]; current: number; go: (index: number) => void; viewed: (file: DiffFile) => boolean }) {
  const seen = files.filter(viewed).length;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="min-w-0">
            <FileCodeIcon data-icon="inline-start" />
            <span className="max-w-[min(22rem,40vw)] truncate font-mono">{files[current]?.path}</span>{" "}
            <span className="text-muted-foreground">{`${current + 1} of ${files.length}`}</span>
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0">
          <div className="max-h-80 overflow-y-auto p-1.5">
            {files.map((file, index) => (
              <DropdownMenuItem key={file.path} onSelect={() => go(index)} className={cn("gap-2.5 text-xs", index === current && "bg-accent")}>
                <CheckIcon className={viewed(file) ? "text-success" : "invisible"} aria-label={viewed(file) ? "viewed" : undefined} />
                <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                <span className="font-mono text-success">{`+${file.additions}`}</span>
                <span className="font-mono text-danger">{`−${file.deletions}`}</span>
              </DropdownMenuItem>
            ))}
          </div>
          <div className="flex justify-between gap-4 border-t px-3.5 py-2 text-xs text-muted-foreground">
            <span>{`${seen} of ${files.length} viewed`}</span>
            <span>[ and ] move between files</span>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Previous file" disabled={current === 0} onClick={() => go(current - 1)}>
        <ChevronLeftIcon />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Next file" disabled={current === files.length - 1} onClick={() => go(current + 1)}>
        <ChevronRightIcon />
      </Button>
    </>
  );
}

/** The gate's last round: the overall comment and every comment, to check the new work against. */
function LastRound({ round }: { round: EarlierRound }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <HistoryIcon data-icon="inline-start" />
          Last round{" "}
          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-secondary px-[5px] text-[11px] font-semibold tabular-nums text-secondary-foreground">
            {round.comments.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96">
        <PopoverHeader>
          <PopoverTitle>Last round</PopoverTitle>
          <PopoverDescription>{round.answer}</PopoverDescription>
        </PopoverHeader>
        <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {round.comments.map((c) => (
            <li key={`${c.path}:${c.line}:${c.body}`} className="flex flex-col gap-0.5 rounded-lg border border-dashed border-input bg-subtle px-3 py-2">
              {c.path && <span className="block truncate font-mono text-[11px] text-muted-foreground">{`${c.path}${c.line ? `:${c.line}${c.endLine ? `-${c.endLine}` : ""}` : ""}`}</span>}
              <div className={PROSE_TIGHT}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.body}</ReactMarkdown>
              </div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

type Props = {
  questionId: string;
  runId: string;
  from: string;
  markdown: string;
  files: DiffFile[];
  views: View[];
  earlier: EarlierRound[];
  tokens?: Record<string, LineTokens> | undefined;
  answered?: LineComment[];
  /**
   * The code reviewing step's verdict and comments; they replace the summary text and sit on their
   * lines. `followUp` is the issue a person already opened from them.
   */
  findings?: (Findings & { by: string; followUp?: FollowUp | undefined }) | undefined;
};

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

/** Which files count as viewed: the saved marks, overridden by what the person clicks on this page. */
function useViewed(runId: string, files: DiffFile[], views: View[], earlier: EarlierRound[], enabled: boolean) {
  const initial = useMemo(() => {
    const at = commentedAt(earlier);
    return new Map(files.map((f) => [f.path, viewState(f, views, at)]));
  }, [files, views, earlier]);
  const [clicked, setClicked] = useState<ReadonlyMap<string, boolean>>(new Map());
  const stateOf = (file: DiffFile): ViewState => {
    const own = clicked.get(file.path);
    return own === undefined ? (initial.get(file.path) ?? { viewed: false }) : own ? { viewed: true } : { viewed: false };
  };
  /** Marks a file and saves the mark; resolves to why it could not be saved, when it could not. */
  const mark = async (file: DiffFile, viewed: boolean) => {
    if (!enabled || !file.blob) return undefined;
    setClicked((map) => new Map(map).set(file.path, viewed));
    const result = await markViewedAction({ runId, path: file.path, blobSha: file.blob, viewed });
    if (!result?.error) return undefined;
    // A mark that was not saved does not stay on the page.
    setClicked((map) => {
      const next = new Map(map);
      next.delete(file.path);
      return next;
    });
    return result.error;
  };
  return { stateOf, mark, initial };
}

/**
 * A code review at a human gate: the sender's summary, then every changed file's diff. Click a line
 * number and shift-click another to comment on the lines between; mark files viewed as you go, and
 * finish with an overall comment and request changes, approve, or approve after fixes.
 */
export function CodeReview({ questionId, runId, from, markdown, files, views, earlier, tokens, answered, findings }: Props) {
  const readOnly = answered !== undefined;
  const draft = useReviewDraft<LineComment>(questionId, !readOnly);
  const comments = readOnly ? answered : draft.comments;
  const { stateOf, mark, initial } = useViewed(runId, files, views, earlier, !readOnly);
  const [mode, setMode] = useState<Mode>("changes");
  const [layout, setLayout] = useState<Layout>("unified");
  // Files already viewed start collapsed.
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set(files.filter((f) => initial.get(f.path)?.viewed).map((f) => f.path)));
  const [selection, setSelection] = useState<LineSelection>();
  const [current, go] = useFileCursor(files.length);
  const last = earlier.at(-1);

  const select = (path: string, side: Side, n: number, extend: boolean) =>
    !readOnly &&
    setSelection((s) =>
      extend && s && s.path === path && s.side === side
        ? { ...s, start: Math.min(s.anchor, n), end: Math.max(s.anchor, n) }
        : { path, side, anchor: n, start: n, end: n, draft: "" },
    );
  const add = (file: DiffFile, body: string) => {
    if (!selection) return;
    const { side, start, end } = selection;
    draft.setComments((list) => [...list, { path: file.path, side, line: start, ...(end !== start ? { endLine: end } : {}), quote: quoteOf(file, side, start, end), body }]);
    setSelection(undefined);
  };
  const setOpen = (path: string, open: boolean) =>
    setClosed((set) => {
      const next = new Set(set);
      if (open) next.delete(path);
      else next.add(path);
      return next;
    });

  const drafted = readOnly ? 0 : comments.length;

  usePageTools(
    "code_review",
    {
      page_go_to_file: ({ path, index, direction }) => {
        if (!files.length) throw new Error("This review has no files.");
        const to = path === undefined && index === undefined ? current + (direction === "previous" ? -1 : 1) : findFile(files, { path, index });
        const at = Math.max(0, Math.min(files.length - 1, to));
        const named = `${at + 1} of ${files.length}: ${files[at]!.path}.`;
        if (at === current && to !== current) return `Already on the ${to < 0 ? "first" : "last"} file, ${named}`;
        setOpen(files[at]!.path, true);
        go(at);
        return `Now on file ${named}`;
      },
      page_set_diff_view: ({ mode: nextMode, layout: nextLayout }) => {
        if (nextMode) setMode(nextMode);
        if (nextLayout) setLayout(nextLayout);
        const shown = (nextMode ?? mode) === "whole" ? "the whole file" : "the changes";
        return `Showing ${shown}, ${(nextLayout ?? layout) === "split" ? "side by side" : "in one column"}.`;
      },
      page_expand_files: undefined,
      page_mark_viewed: readOnly
        ? undefined
        : async ({ path, viewed }) => {
            const file = files[findFile(files, { path })]!;
            if (!file.blob) throw new Error(`${path} cannot be marked viewed: the review does not show its content.`);
            const error = await mark(file, viewed);
            if (error) throw new Error(error);
            setOpen(path, !viewed);
            const seen = files.filter((f) => (f.path === path ? viewed : stateOf(f).viewed)).length;
            return `Marked ${path} as ${viewed ? "viewed and collapsed" : "not viewed and expanded"} it. ${seen} of ${files.length} viewed.`;
          },
      page_comment_on_lines: readOnly
        ? undefined
        : ({ path, line, endLine, side = "new", body }) => {
            const file = files[findFile(files, { path })]!;
            checkLines(file, side, line, endLine ?? line);
            const comment: LineComment = { path, side, line, ...(endLine !== undefined && endLine !== line ? { endLine } : {}), quote: quoteOf(file, side, line, endLine ?? line), body };
            draft.setComments((list) => [...list, comment]);
            setOpen(path, true);
            return `Drafted a comment on ${linesText(side, line, comment.endLine)} of ${path}. ${commentCount(comments.length + 1)}.`;
          },
      page_remove_line_comment: undefined,
      page_set_note: undefined,
      page_submit_review: undefined,
    },
    () => ({ questionId, runId, from, current: files.length ? current + 1 : null,
      mode,
      layout,
      files: files.map((f, i) => ({
        index: i + 1,
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        viewed: stateOf(f).viewed,
        open: !closed.has(f.path),
        comments: comments.filter((c) => c.path === f.path).length,
      })),
      comments,
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      {findings ? (
        <FindingsSummary
          findings={findings}
          by={findings.by}
          followUp={findings.followUp}
          runId={runId}
          questionId={questionId}
          files={files}
          open={(index) => {
            setOpen(files[index]!.path, true);
            go(index);
          }}
        />
      ) : (
        <article className={cn(CARD, PROSE, "px-6 py-5")}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </article>
      )}
      <div className="sticky top-[60px] z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-background/90 p-2 backdrop-blur-md">
        <FileMenu files={files} current={current} go={go} viewed={(f) => stateOf(f).viewed} />
        <ToggleGroup type="single" spacing={0.5} value={mode} onValueChange={(value) => value && setMode(value as Mode)} aria-label="Show" className={SEG}>
          <ToggleGroupItem value="changes" className={SEG_ITEM}>
            Changes
          </ToggleGroupItem>
          <ToggleGroupItem value="whole" className={SEG_ITEM}>
            Whole file
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" spacing={0.5} value={layout} onValueChange={(value) => value && setLayout(value as Layout)} aria-label="Layout" className={SEG}>
          <ToggleGroupItem value="unified" className={SEG_ITEM}>
            Unified
          </ToggleGroupItem>
          <ToggleGroupItem value="split" className={SEG_ITEM}>
            Split
          </ToggleGroupItem>
        </ToggleGroup>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Collapse all files" onClick={() => setClosed(new Set(files.map((f) => f.path)))}>
          <ChevronsDownUpIcon />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Expand all files" onClick={() => setClosed(new Set())}>
          <ChevronsUpDownIcon />
        </Button>
        {last && last.comments.length > 0 && <LastRound round={last} />}
        {drafted > 0 && <span className="ml-auto text-xs text-muted-foreground">{`${drafted} ${drafted === 1 ? "comment" : "comments"} drafted`}</span>}
        {!readOnly && (
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" size="sm" className={cn(drafted === 0 && "ml-auto")}>
                Submit review
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(25rem,calc(100vw-2rem))]">
              <PopoverHeader>
                <PopoverTitle>Submit review</PopoverTitle>
                <PopoverDescription>{`Comments go back to ${from}.`}</PopoverDescription>
              </PopoverHeader>
              <SubmitReview
                questionId={questionId}
                runId={runId}
                target={from}
                comments={comments}
                note={draft.note}
                setNote={draft.setNote}
                onSending={draft.onSending}
                onFailed={draft.onFailed}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
      {files.map((file, index) => (
        <FileDiff
          key={file.path}
          index={index}
          file={file}
          mode={mode}
          layout={layout}
          open={!closed.has(file.path)}
          onToggle={() => setOpen(file.path, closed.has(file.path))}
          view={stateOf(file)}
          onViewed={
            readOnly
              ? undefined
              : (viewed) => {
                  void mark(file, viewed);
                  setOpen(file.path, !viewed);
                }
          }
          selection={selection?.path === file.path ? selection : undefined}
          comments={comments.filter((c) => c.path === file.path)}
          earlier={placeEarlier(file, last?.comments ?? [])}
          findings={findings && { by: findings.by, ...placeFindings(file, findings.comments) }}
          tokens={tokens?.[file.path]}
          onSelect={(side, n, extend) => select(file.path, side, n, extend)}
          onAdd={(body) => add(file, body)}
          onCancel={() => setSelection(undefined)}
          onDraft={(text) => setSelection((s) => s && { ...s, draft: text })}
          onRemove={readOnly ? undefined : (comment: LineComment) => draft.setComments((list) => list.filter((c) => c !== comment))}
        />
      ))}
    </div>
  );
}
