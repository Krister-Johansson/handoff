"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronsDownUpIcon, ChevronsUpDownIcon } from "lucide-react";
import type { DiffFile } from "@handoff/core";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { numberOn, type LineComment, type LineSelection, type Side } from "@/lib/line-comments";
import { FileDiff } from "./file-diff";
import { SubmitReview } from "./submit-review";

type Mode = "changes" | "whole";

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

function FileMenu({ files, current, go }: { files: DiffFile[]; current: number; go: (index: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            {`File ${current + 1} of ${files.length}`}
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-96 overflow-y-auto">
          {files.map((file, index) => (
            <DropdownMenuItem key={file.path} onSelect={() => go(index)}>
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

type Props = {
  questionId: string;
  runId: string;
  from: string;
  markdown: string;
  files: DiffFile[];
  answered?: LineComment[];
};

/**
 * A code review at a human gate: the sender's summary, then every changed file's diff. Click a line
 * number and shift-click another to comment on the lines between; finish with an overall comment
 * and request changes, approve, or approve after fixes.
 */
export function CodeReview({ questionId, runId, from, markdown, files, answered }: Props) {
  const readOnly = answered !== undefined;
  const [mode, setMode] = useState<Mode>("changes");
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [selection, setSelection] = useState<LineSelection>();
  const [comments, setComments] = useState<LineComment[]>(answered ?? []);
  const [current, go] = useFileCursor(files.length);

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
    setComments((list) => [
      ...list,
      {
        path: file.path,
        side,
        line: start,
        ...(end !== start ? { endLine: end } : {}),
        quote: quoteOf(file, side, start, end),
        body,
      },
    ]);
    setSelection(undefined);
  };
  const toggle = (path: string) =>
    setClosed((set) => {
      const next = new Set(set);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <article className="prose prose-sm max-w-none rounded-lg border p-4 dark:prose-invert prose-code:before:content-none prose-code:after:content-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </article>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-2 backdrop-blur">
        <FileMenu files={files} current={current} go={go} />
        <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(value) => value && setMode(value as Mode)} aria-label="Show">
          <ToggleGroupItem value="changes">Changes</ToggleGroupItem>
          <ToggleGroupItem value="whole">Whole file</ToggleGroupItem>
        </ToggleGroup>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Collapse all files" onClick={() => setClosed(new Set(files.map((f) => f.path)))}>
          <ChevronsDownUpIcon />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Expand all files" onClick={() => setClosed(new Set())}>
          <ChevronsUpDownIcon />
        </Button>
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
              <SubmitReview questionId={questionId} runId={runId} target={from} comments={comments} />
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
          open={!closed.has(file.path)}
          onToggle={() => toggle(file.path)}
          selection={selection?.path === file.path ? selection : undefined}
          comments={comments.filter((c) => c.path === file.path)}
          onSelect={(side, n, extend) => select(file.path, side, n, extend)}
          onAdd={(body) => add(file, body)}
          onCancel={() => setSelection(undefined)}
          onDraft={(draft) => setSelection((s) => s && { ...s, draft })}
          {...(readOnly
            ? {}
            : {
                onRemove: (comment: LineComment) => setComments((list) => list.filter((c) => c !== comment)),
              })}
        />
      ))}
    </div>
  );
}
