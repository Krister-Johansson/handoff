"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, CopyIcon, MessageSquarePlusIcon, MessageSquareIcon, UnfoldVerticalIcon, XIcon } from "lucide-react";
import type { DiffFile, DiffLine } from "@handoff/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { diffRows } from "@/lib/diff-rows";
import { numberOn, rangeLabel, type LineComment, type LineSelection, type Side } from "@/lib/line-comments";
import { cn } from "@/lib/utils";

const COLLAPSED: Record<NonNullable<DiffFile["collapsed"]>, string> = {
  generated: "Generated file. Its changes are not shown.",
  large: "This file is too large to show.",
  limit: "Not shown: the change is too large to show every file.",
};

const TONE: Record<DiffLine["kind"], string> = {
  add: "bg-emerald-500/10 dark:bg-emerald-500/15",
  del: "bg-red-500/10 dark:bg-red-500/15",
  context: "",
};

const MARK: Record<DiffLine["kind"], string> = {
  add: "+",
  del: "−",
  context: " ",
};

function LineNumber({ line, side, selected, onSelect }: { line: DiffLine; side: Side; selected: boolean; onSelect: (side: Side, n: number, extend: boolean) => void }) {
  const n = numberOn(line, side);
  if (n === undefined) return <td className="w-10 select-none" />;
  return (
    <td className="w-10 p-0 text-right align-top">
      <button
        type="button"
        aria-label={side === "new" ? `Select line ${n}` : `Select old line ${n}`}
        aria-pressed={selected}
        className={cn("w-full px-2 font-mono text-xs text-muted-foreground tabular-nums hover:text-foreground", selected && "text-foreground")}
        onClick={(e) => onSelect(side, n, e.shiftKey)}
      >
        {n}
      </button>
    </td>
  );
}

function Composer({ label, body, setBody, onAdd, onCancel }: { label: string; body: string; setBody: (body: string) => void; onAdd: (body: string) => void; onCancel: () => void }) {
  const id = `composer-${label.replace(/\W+/g, "-")}`;
  return (
    <Field className="p-3">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea id={id} rows={3} value={body} autoFocus onChange={(e) => setBody(e.target.value)} />
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={!body.trim()} onClick={() => onAdd(body.trim())}>
          <MessageSquarePlusIcon data-icon="inline-start" />
          Add comment
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Field>
  );
}

function InlineComment({ comment, onRemove }: { comment: LineComment; onRemove: (() => void) | undefined }) {
  const where = comment.endLine ? `L${comment.line}–${comment.endLine}` : `L${comment.line}`;
  return (
    <div className="m-2 flex items-start gap-2 rounded-md border bg-background p-2 text-sm">
      <MessageSquareIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-mono text-xs text-muted-foreground">{comment.side === "old" ? `old ${where}` : where}</span>
        <span className="whitespace-pre-wrap">{comment.body}</span>
      </div>
      {onRemove && (
        <Button type="button" size="icon-xs" variant="ghost" aria-label={`Remove comment on ${comment.path} ${where}`} onClick={onRemove}>
          <XIcon />
        </Button>
      )}
    </div>
  );
}

type DiffProps = {
  file: DiffFile;
  mode: "changes" | "whole";
  selection: LineSelection | undefined;
  comments: LineComment[];
  onSelect: (side: Side, n: number, extend: boolean) => void;
  onAdd: (body: string) => void;
  onCancel: () => void;
  onDraft: (body: string) => void;
  /** Absent on an answered review, whose comments stay. */
  onRemove?: (comment: LineComment) => void;
};

function DiffTable({ file, mode, selection, comments, onSelect, onAdd, onCancel, onDraft, onRemove }: DiffProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const inSelection = (line: DiffLine) => {
    const n = selection ? numberOn(line, selection.side) : undefined;
    return n !== undefined && n >= selection!.start && n <= selection!.end;
  };
  const endsHere = (line: DiffLine, side: Side, end: number) => numberOn(line, side) === end && (side === "new" ? line.kind !== "del" : line.kind !== "add");
  return (
    <table className="w-full border-collapse font-mono text-xs">
      <tbody>
        {diffRows(file, { mode, expanded }).map((row) => {
          if (row.kind === "gap")
            return (
              <tr key={row.id} className="bg-muted/50">
                <td colSpan={4} className="px-3 py-1 text-muted-foreground">
                  ⋯
                </td>
              </tr>
            );
          if (row.kind === "fold")
            return (
              <tr key={row.id} className="bg-muted/50">
                <td colSpan={4} className="p-0">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1 text-left text-muted-foreground hover:text-foreground"
                    onClick={() => setExpanded((set) => new Set(set).add(row.id))}
                  >
                    <UnfoldVerticalIcon className="size-3.5" />
                    {`Show ${row.lines.length} unmodified lines`}
                  </button>
                </td>
              </tr>
            );
          const { line } = row;
          const here = comments.filter((c) => endsHere(line, c.side, c.endLine ?? c.line));
          const composerHere = selection && endsHere(line, selection.side, selection.end);
          return [
            <tr key={`${line.kind}:${line.oldLine}:${line.newLine}`} className={cn(TONE[line.kind], inSelection(line) && "bg-accent")}>
              <LineNumber line={line} side="old" selected={selection?.side === "old" && inSelection(line)} onSelect={onSelect} />
              <LineNumber line={line} side="new" selected={selection?.side === "new" && inSelection(line)} onSelect={onSelect} />
              <td className="w-4 select-none text-center align-top text-muted-foreground">{MARK[line.kind]}</td>
              <td className="whitespace-pre-wrap break-all pr-3 align-top">{line.text}</td>
            </tr>,
            ...here.map((comment) => (
              <tr key={`comment:${comment.side}:${comment.line}:${comment.body}`}>
                <td colSpan={4}>
                  <InlineComment comment={comment} onRemove={onRemove && (() => onRemove(comment))} />
                </td>
              </tr>
            )),
            ...(composerHere
              ? [
                  <tr key="composer">
                    <td colSpan={4} className="bg-muted/30">
                      <Composer label={`Comment on ${file.path} ${rangeLabel(selection.start, selection.end)}`} body={selection.draft} setBody={onDraft} onAdd={onAdd} onCancel={onCancel} />
                    </td>
                  </tr>,
                ]
              : []),
          ];
        })}
      </tbody>
    </table>
  );
}

type FileDiffProps = DiffProps & {
  index: number;
  open: boolean;
  onToggle: () => void;
};

/** One changed file: a header with its counts and comments, and its diff unless it is collapsed. */
export function FileDiff({ index, open, onToggle, ...diff }: FileDiffProps) {
  const { file, comments } = diff;
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <section id={`review-file-${index}`} aria-label={file.path} className="scroll-mt-20 overflow-hidden rounded-lg border">
      <header className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-2 py-1.5 text-sm">
        <Button type="button" size="icon-xs" variant="ghost" aria-label={`${open ? "Collapse" : "Expand"} ${file.path}`} aria-expanded={open} onClick={onToggle}>
          <Chevron />
        </Button>
        <span className="min-w-0 truncate font-mono">{file.path}</span>
        {file.oldPath && <span className="truncate font-mono text-xs text-muted-foreground">from {file.oldPath}</span>}
        <Button type="button" size="icon-xs" variant="ghost" aria-label={`Copy ${file.path}`} onClick={() => void navigator.clipboard?.writeText(file.path)}>
          <CopyIcon />
        </Button>
        {file.status !== "modified" && <Badge variant="outline">{file.status}</Badge>}
        <span className="ml-auto flex items-center gap-2 font-mono text-xs">
          <span className="text-red-600 dark:text-red-400">{`−${file.deletions}`}</span>
          <span className="text-emerald-600 dark:text-emerald-400">{`+${file.additions}`}</span>
          {comments.length > 0 && (
            <span className="flex items-center gap-1 text-muted-foreground" aria-label={`${comments.length} comments`}>
              <MessageSquareIcon className="size-3.5" />
              {comments.length}
            </span>
          )}
        </span>
      </header>
      {open &&
        (file.collapsed ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{COLLAPSED[file.collapsed]}</p>
        ) : file.status === "binary" ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">Binary file.</p>
        ) : (
          <div className="overflow-x-auto">
            <DiffTable {...diff} />
          </div>
        ))}
    </section>
  );
}
