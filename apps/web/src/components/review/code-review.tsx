"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronsDownUpIcon, ChevronsUpDownIcon, HistoryIcon } from "lucide-react";
import type { DiffFile } from "@handoff/core";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { markViewedAction } from "@/app/inbox/actions";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { commentedAt, placeEarlier, type EarlierRound } from "@/lib/earlier";
import type { LineTokens } from "@/lib/highlight-types";
import { numberOn, type LineComment, type LineSelection, type Side } from "@/lib/line-comments";
import { useReviewDraft } from "@/lib/use-review-draft";
import { viewState, type View, type ViewState } from "@/lib/viewed";
import { FileDiff } from "./file-diff";
import { SubmitReview } from "./submit-review";

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
  const left = files.filter((f) => !viewed(f)).length;
  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            {`File ${current + 1} of ${files.length} · ${left} left`}
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-96 overflow-y-auto">
          {files.map((file, index) => (
            <DropdownMenuItem key={file.path} onSelect={() => go(index)}>
              <CheckIcon className={viewed(file) ? "text-emerald-600" : "invisible"} aria-label={viewed(file) ? "viewed" : undefined} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
              <span className="font-mono text-xs text-red-600 dark:text-red-400">{`−${file.deletions}`}</span>
              <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">{`+${file.additions}`}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Previous file" disabled={current === 0} onClick={() => go(current - 1)}>
        <ChevronLeftIcon />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Next file" disabled={current === files.length - 1} onClick={() => go(current + 1)}>
        <ChevronRightIcon />
      </Button>
    </div>
  );
}

/** The gate's last round: the overall comment and every comment, to check the new work against. */
function LastRound({ round }: { round: EarlierRound }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <HistoryIcon data-icon="inline-start" />
          {`Last round (${round.comments.length})`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96">
        <PopoverHeader>
          <PopoverTitle>Last round</PopoverTitle>
          <PopoverDescription>{round.answer}</PopoverDescription>
        </PopoverHeader>
        <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto text-sm">
          {round.comments.map((c) => (
            <li key={`${c.path}:${c.line}:${c.body}`} className="rounded-md border p-2">
              {c.path && <span className="block truncate font-mono text-xs text-muted-foreground">{`${c.path}${c.line ? `:${c.line}${c.endLine ? `-${c.endLine}` : ""}` : ""}`}</span>}
              <span className="whitespace-pre-wrap">{c.body}</span>
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
};

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
  const mark = (file: DiffFile, viewed: boolean) => {
    if (!enabled || !file.blob) return;
    setClicked((map) => new Map(map).set(file.path, viewed));
    void markViewedAction({ runId, path: file.path, blobSha: file.blob, viewed });
  };
  return { stateOf, mark, initial };
}

/**
 * A code review at a human gate: the sender's summary, then every changed file's diff. Click a line
 * number and shift-click another to comment on the lines between; mark files viewed as you go, and
 * finish with an overall comment and request changes, approve, or approve after fixes.
 */
export function CodeReview({ questionId, runId, from, markdown, files, views, earlier, tokens, answered }: Props) {
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

  return (
    <div className="flex flex-col gap-4">
      <article className="prose prose-sm max-w-none rounded-lg border p-4 dark:prose-invert prose-code:before:content-none prose-code:after:content-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </article>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-2 backdrop-blur">
        <FileMenu files={files} current={current} go={go} viewed={(f) => stateOf(f).viewed} />
        <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(value) => value && setMode(value as Mode)} aria-label="Show">
          <ToggleGroupItem value="changes">Changes</ToggleGroupItem>
          <ToggleGroupItem value="whole">Whole file</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" variant="outline" size="sm" value={layout} onValueChange={(value) => value && setLayout(value as Layout)} aria-label="Layout">
          <ToggleGroupItem value="unified">Unified</ToggleGroupItem>
          <ToggleGroupItem value="split">Split</ToggleGroupItem>
        </ToggleGroup>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Collapse all files" onClick={() => setClosed(new Set(files.map((f) => f.path)))}>
          <ChevronsDownUpIcon />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Expand all files" onClick={() => setClosed(new Set())}>
          <ChevronsUpDownIcon />
        </Button>
        {last && last.comments.length > 0 && <LastRound round={last} />}
        {!readOnly && (
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" size="sm" className="ml-auto">
                Submit review
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96">
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
                  mark(file, viewed);
                  setOpen(file.path, !viewed);
                }
          }
          selection={selection?.path === file.path ? selection : undefined}
          comments={comments.filter((c) => c.path === file.path)}
          earlier={placeEarlier(file, last?.comments ?? [])}
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
