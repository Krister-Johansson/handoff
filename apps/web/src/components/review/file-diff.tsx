"use client";

import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BotIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon, HistoryIcon, MessageSquareIcon, MessageSquarePlusIcon, UnfoldVerticalIcon, XIcon } from "lucide-react";
import type { DiffFile, DiffLine } from "@handoff/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { diffRows, type DiffRow } from "@/lib/diff-rows";
import type { EarlierComment } from "@/lib/earlier";
import type { Finding } from "@/lib/findings";
import { numberOn, rangeLabel, type LineComment, type LineSelection, type Side } from "@/lib/line-comments";
import type { LineTokens } from "@/lib/highlight-types";
import { cn } from "@/lib/utils";
import type { ViewState } from "@/lib/viewed";

const COLLAPSED: Record<NonNullable<DiffFile["collapsed"]>, string> = {
  generated: "Generated file. Its changes are not shown.",
  large: "This file is too large to show.",
  limit: "Not shown: the change is too large to show every file.",
};

const UNVIEWED: Record<"changed" | "commented", string> = {
  changed: "Changed since you viewed it",
  commented: "You commented on it last round",
};

const TONE: Record<DiffLine["kind"], string> = {
  add: "bg-emerald-500/10 dark:bg-emerald-500/15",
  del: "bg-red-500/10 dark:bg-red-500/15",
  context: "",
};

const MARK: Record<DiffLine["kind"], string> = { add: "+", del: "−", context: " " };

/** The side a line's own text belongs to: deleted lines are only in the old file. */
const sideOf = (line: DiffLine): Side => (line.kind === "del" ? "old" : "new");

function LineNumber({ line, side, selected, onSelect }: { line: DiffLine | undefined; side: Side; selected: boolean; onSelect: (side: Side, n: number, extend: boolean) => void }) {
  const n = line && numberOn(line, side);
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

/** A line's code, coloured when the page highlighted it. */
function Code({ line, side = sideOf(line), tokens }: { line: DiffLine; side?: Side; tokens: LineTokens | undefined }) {
  const n = numberOn(line, side);
  const colored = n !== undefined ? tokens?.[side]?.[n] : undefined;
  if (!colored) return <>{line.text}</>;
  return (
    <>
      {colored.map((t, i) => (
        // Tokens of one line never reorder, so their position is a stable key.
        <span key={i} style={t.style}>
          {t.content}
        </span>
      ))}
    </>
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

const where = (c: { line?: number | undefined; endLine?: number | undefined; side?: Side | undefined }) =>
  c.line === undefined ? "" : `${c.side === "old" ? "old " : ""}L${c.line}${c.endLine ? `–${c.endLine}` : ""}`;

function InlineComment({ comment, onRemove }: { comment: LineComment; onRemove: (() => void) | undefined }) {
  return (
    <div className="m-2 flex items-start gap-2 rounded-md border bg-background p-2 font-sans text-sm">
      <MessageSquareIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-mono text-xs text-muted-foreground">{where(comment)}</span>
        <span className="whitespace-pre-wrap">{comment.body}</span>
      </div>
      {onRemove && (
        <Button type="button" size="icon-xs" variant="ghost" aria-label={`Remove comment on ${comment.path} ${where(comment)}`} onClick={onRemove}>
          <XIcon />
        </Button>
      )}
    </div>
  );
}

/** A comment from the gate's last round, muted so it reads as history rather than as this review. */
function EarlierNote({ comment, outdated }: { comment: EarlierComment; outdated?: boolean }) {
  return (
    <div data-outdated={outdated ? "" : undefined} className="m-2 flex items-start gap-2 rounded-md border border-dashed bg-muted/40 p-2 font-sans text-sm text-muted-foreground">
      <HistoryIcon className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-mono text-xs">{`Last round${where(comment) ? ` · ${where(comment)}` : ""}${outdated ? " · outdated" : ""}`}</span>
        {outdated && comment.quote && <span className="truncate font-mono text-xs">{comment.quote}</span>}
        <span className="whitespace-pre-wrap text-foreground">{comment.body}</span>
      </div>
    </div>
  );
}

/** A comment from the code reviewing agent, set apart from the person's own comments. */
function FindingNote({ finding, by, loose }: { finding: Finding; by: string; loose?: boolean }) {
  return (
    <div className="m-2 flex items-start gap-2 rounded-md border bg-sky-50/60 p-2 font-sans text-sm dark:bg-sky-950/30">
      <BotIcon className="mt-0.5 size-4 shrink-0 text-sky-700 dark:text-sky-300" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-mono text-xs text-muted-foreground">{`${by}${loose && finding.line !== undefined ? ` · line ${finding.line}, outside the diff` : ""}`}</span>
        <div className="prose prose-sm max-w-none dark:prose-invert prose-code:before:content-none prose-code:after:content-none prose-p:my-1">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{finding.body}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

/** The code reviewing agent's findings on one file: on their lines, or loose at the top of the file. */
export type PlacedFindings = { by: string; anchored: { line: number; finding: Finding }[]; loose: Finding[] };

type DiffProps = {
  file: DiffFile;
  mode: "changes" | "whole";
  layout: "unified" | "split";
  selection: LineSelection | undefined;
  comments: LineComment[];
  earlier: { anchored: { line: number; comment: EarlierComment }[]; outdated: EarlierComment[] };
  findings?: PlacedFindings | undefined;
  tokens?: LineTokens | undefined;
  onSelect: (side: Side, n: number, extend: boolean) => void;
  onAdd: (body: string) => void;
  onCancel: () => void;
  onDraft: (body: string) => void;
  /** Absent on an answered review, whose comments stay. */
  onRemove?: ((comment: LineComment) => void) | undefined;
};

type Pair = { left?: DiffLine; right?: DiffLine };

/** Unified rows as side-by-side pairs: each run of deletions sits next to the additions that replaced it. */
function pairs(rows: DiffRow[]): (DiffRow | { kind: "pair"; pair: Pair })[] {
  const out: (DiffRow | { kind: "pair"; pair: Pair })[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) out.push({ kind: "pair", pair: { ...(dels[i] ? { left: dels[i] } : {}), ...(adds[i] ? { right: adds[i] } : {}) } });
    dels = [];
    adds = [];
  };
  for (const row of rows) {
    if (row.kind === "line" && row.line.kind === "del") dels.push(row.line);
    else if (row.kind === "line" && row.line.kind === "add") adds.push(row.line);
    else {
      flush();
      out.push(row.kind === "line" ? { kind: "pair", pair: { left: row.line, right: row.line } } : row);
    }
  }
  flush();
  return out;
}

function DiffTable({ file, mode, layout, selection, comments, earlier, findings, tokens, onSelect, onAdd, onCancel, onDraft, onRemove }: DiffProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const span = layout === "split" ? 6 : 4;
  const inSelection = (line: DiffLine | undefined, side: Side) => {
    const n = line && selection?.side === side ? numberOn(line, side) : undefined;
    return n !== undefined && n >= selection!.start && n <= selection!.end;
  };
  const endsHere = (line: DiffLine | undefined, side: Side, end: number) => !!line && numberOn(line, side) === end && (side === "new" ? line.kind !== "del" : line.kind !== "add");

  /** Comments, last round's notes and the composer that belong under these lines. */
  const extras = (lines: DiffLine[]): ReactNode[] => {
    const at = (side: Side, end: number) => lines.some((l) => endsHere(l, side, end));
    const rows: ReactNode[] = [];
    for (const comment of comments.filter((c) => at(c.side, c.endLine ?? c.line)))
      rows.push(
        <tr key={`comment:${comment.side}:${comment.line}:${comment.body}`}>
          <td colSpan={span}>
            <InlineComment comment={comment} onRemove={onRemove && (() => onRemove(comment))} />
          </td>
        </tr>,
      );
    for (const note of findings?.anchored.filter((f) => at("new", f.line)) ?? [])
      rows.push(
        <tr key={`finding:${note.line}:${note.finding.body}`}>
          <td colSpan={span}>
            <FindingNote finding={note.finding} by={findings!.by} />
          </td>
        </tr>,
      );
    for (const note of earlier.anchored.filter((e) => at("new", e.line)))
      rows.push(
        <tr key={`earlier:${note.line}:${note.comment.body}`}>
          <td colSpan={span}>
            <EarlierNote comment={note.comment} />
          </td>
        </tr>,
      );
    if (selection && at(selection.side, selection.end))
      rows.push(
        <tr key="composer">
          <td colSpan={span} className="bg-muted/30">
            <Composer label={`Comment on ${file.path} ${rangeLabel(selection.start, selection.end)}`} body={selection.draft} setBody={onDraft} onAdd={onAdd} onCancel={onCancel} />
          </td>
        </tr>,
      );
    return rows;
  };

  const fold = (row: Extract<DiffRow, { kind: "fold" }>) => (
    <tr key={row.id} className="bg-muted/50">
      <td colSpan={span} className="p-0">
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
  const gap = (id: string) => (
    <tr key={id} className="bg-muted/50">
      <td colSpan={span} className="px-3 py-1 text-muted-foreground">
        ⋯
      </td>
    </tr>
  );

  const rows = diffRows(file, { mode, expanded });
  return (
    <table className="shiki-code w-full table-fixed border-collapse font-mono text-xs">
      <colgroup>
        {layout === "split" ? (
          <>
            <col className="w-10" />
            <col className="w-4" />
            <col />
            <col className="w-10" />
            <col className="w-4" />
            <col />
          </>
        ) : (
          <>
            <col className="w-10" />
            <col className="w-10" />
            <col className="w-4" />
            <col />
          </>
        )}
      </colgroup>
      <tbody>
        {layout === "unified"
          ? rows.map((row) => {
              if (row.kind === "gap") return gap(row.id);
              if (row.kind === "fold") return fold(row);
              const { line } = row;
              const selected = inSelection(line, "old") || inSelection(line, "new");
              return [
                <tr key={`${line.kind}:${line.oldLine}:${line.newLine}`} className={cn(TONE[line.kind], selected && "bg-accent")}>
                  <LineNumber line={line} side="old" selected={inSelection(line, "old")} onSelect={onSelect} />
                  <LineNumber line={line} side="new" selected={inSelection(line, "new")} onSelect={onSelect} />
                  <td className="select-none text-center align-top text-muted-foreground">{MARK[line.kind]}</td>
                  <td className="whitespace-pre-wrap break-all pr-3 align-top">
                    <Code line={line} tokens={tokens} />
                  </td>
                </tr>,
                ...extras([line]),
              ];
            })
          : pairs(rows).map((row) => {
              if (row.kind === "gap") return gap(row.id);
              if (row.kind === "fold") return fold(row);
              if (row.kind === "line") return null;
              const { left, right } = row.pair;
              const half = (line: DiffLine | undefined, side: Side) => {
                const tone = line ? (line.kind === "context" ? "" : TONE[line.kind]) : "bg-muted/30";
                return [
                  <LineNumber key={`${side}-n`} line={line} side={side} selected={inSelection(line, side)} onSelect={onSelect} />,
                  <td key={`${side}-m`} className={cn("select-none text-center align-top text-muted-foreground", tone, inSelection(line, side) && "bg-accent")}>
                    {line && line.kind !== "context" ? MARK[line.kind] : " "}
                  </td>,
                  <td key={`${side}-c`} className={cn("whitespace-pre-wrap break-all pr-3 align-top", tone, inSelection(line, side) && "bg-accent")}>
                    {line && <Code line={line} side={side} tokens={tokens} />}
                  </td>,
                ];
              };
              return [
                <tr key={`pair:${left?.oldLine}:${right?.newLine}`}>
                  {half(left, "old")}
                  {half(right, "new")}
                </tr>,
                ...extras([left, right].filter((l): l is DiffLine => !!l)),
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
  view: ViewState;
  /** Absent on an answered review. */
  onViewed?: ((viewed: boolean) => void) | undefined;
};

function ViewedButton({ path, viewed, onViewed }: { path: string; viewed: boolean; onViewed: (viewed: boolean) => void }) {
  return (
    <Button
      type="button"
      size="xs"
      variant={viewed ? "secondary" : "outline"}
      aria-label={viewed ? `Mark ${path} not viewed` : `Mark ${path} viewed`}
      aria-pressed={viewed}
      onClick={() => onViewed(!viewed)}
    >
      {viewed && <CheckIcon data-icon="inline-start" />}
      {viewed ? "Viewed" : "Mark viewed"}
    </Button>
  );
}

/** One changed file: a header with its counts, comments and viewed mark, and its diff unless it is collapsed. */
export function FileDiff({ index, open, onToggle, view, onViewed, ...diff }: FileDiffProps) {
  const { file, comments, earlier, findings } = diff;
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
        {!view.viewed && view.reason && <Badge variant="secondary">{UNVIEWED[view.reason]}</Badge>}
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
        {onViewed && file.blob && <ViewedButton path={file.path} viewed={view.viewed} onViewed={onViewed} />}
      </header>
      {open && findings?.loose.map((finding) => <FindingNote key={`loose:${finding.line}:${finding.body}`} finding={finding} by={findings.by} loose />)}
      {open && earlier.outdated.map((comment) => <EarlierNote key={`outdated:${comment.line}:${comment.body}`} comment={comment} outdated />)}
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
