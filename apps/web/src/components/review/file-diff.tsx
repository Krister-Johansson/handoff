"use client";

import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BotIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon, HistoryIcon, MessageSquareIcon, MessageSquarePlusIcon, UnfoldVerticalIcon, XIcon } from "lucide-react";
import type { DiffFile, DiffLine } from "@handoff/core";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { diffRows, type DiffRow } from "@/lib/diff-rows";
import type { EarlierComment } from "@/lib/earlier";
import type { Finding } from "@/lib/findings";
import { numberOn, rangeLabel, type LineComment, type LineSelection, type Side } from "@/lib/line-comments";
import type { LineTokens } from "@/lib/highlight-types";
import { cn } from "@/lib/utils";
import type { ViewState } from "@/lib/viewed";
import { PROSE_TIGHT } from "./styles";

const COLLAPSED: Record<NonNullable<DiffFile["collapsed"]>, string> = {
  generated: "Generated file. Its changes are not shown.",
  large: "This file is too large to show.",
  limit: "Not shown: the change is too large to show every file.",
};

const UNVIEWED: Record<"changed" | "commented", string> = {
  changed: "Changed since you viewed it",
  commented: "You commented on it last round",
};

/** What a file's header says about how it changed; a plain modification says nothing. */
const STATUS: Record<Exclude<DiffFile["status"], "modified">, string> = {
  added: "new file",
  deleted: "deleted",
  renamed: "renamed",
  binary: "binary",
};

/** Row colours: added and deleted lines on a soft tint, their line numbers on a stronger one. */
const TONE: Record<DiffLine["kind"], string> = {
  add: "bg-success-dot/12",
  del: "bg-danger-dot/12",
  context: "",
};
const NUMBER_TONE: Record<DiffLine["kind"], string> = {
  add: "bg-success-dot/22",
  del: "bg-danger-dot/22",
  context: "",
};
const MARK_TONE: Record<DiffLine["kind"], string> = { add: "text-success", del: "text-danger", context: "text-muted-foreground/70" };

const MARK: Record<DiffLine["kind"], string> = { add: "+", del: "−", context: " " };

/** The side a line's own text belongs to: deleted lines are only in the old file. */
const sideOf = (line: DiffLine): Side => (line.kind === "del" ? "old" : "new");

function LineNumber({ line, side, selected, onSelect }: { line: DiffLine | undefined; side: Side; selected: boolean; onSelect: (side: Side, n: number, extend: boolean) => void }) {
  const n = line && numberOn(line, side);
  if (n === undefined) return <td className={cn("border-r select-none", line && NUMBER_TONE[line.kind])} />;
  return (
    <td className={cn("border-r p-0 text-right align-top", NUMBER_TONE[line!.kind], selected && "bg-active-bg")}>
      <button
        type="button"
        aria-label={side === "new" ? `Select line ${n}` : `Select old line ${n}`}
        aria-pressed={selected}
        className={cn("w-full px-2 font-mono text-xs text-muted-foreground/70 tabular-nums hover:text-foreground", selected && "text-foreground")}
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

/** Notes under a line: indented past the line numbers, in the page's sans font. */
const NOTE = "mx-3 my-2 flex items-start gap-2.5 rounded-lg border px-3 py-2.5 font-sans text-[13px] sm:ml-[60px]";
const WHO = "font-mono text-[11px] text-muted-foreground";

function Composer({ label, body, setBody, onAdd, onCancel }: { label: string; body: string; setBody: (body: string) => void; onAdd: (body: string) => void; onCancel: () => void }) {
  const id = `composer-${label.replace(/\W+/g, "-")}`;
  return (
    <Field className="mx-3 mt-2 mb-2.5 gap-2 rounded-lg border border-input bg-card px-3 py-2.5 font-sans sm:ml-[60px] sm:w-auto">
      <FieldLabel htmlFor={id} className="text-xs">
        {label}
      </FieldLabel>
      <Textarea id={id} rows={2} value={body} autoFocus onChange={(e) => setBody(e.target.value)} className="bg-subtle" />
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

/** A comment of this review. While it is a draft it is the person's own and can be removed. */
function InlineComment({ comment, onRemove }: { comment: LineComment; onRemove: (() => void) | undefined }) {
  return (
    <div className={cn(NOTE, "border-input bg-card")}>
      <MessageSquareIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={WHO}>{onRemove ? `you · ${where(comment)}` : where(comment)}</span>
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
    <div data-outdated={outdated ? "" : undefined} className={cn(NOTE, "border-dashed border-input bg-subtle text-muted-foreground")}>
      <HistoryIcon className="mt-0.5 size-3.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={WHO}>{`Last round${where(comment) ? ` · ${where(comment)}` : ""}${outdated ? " · outdated" : ""}`}</span>
        {outdated && comment.quote && <span className="truncate font-mono text-xs">{comment.quote}</span>}
        <span className="whitespace-pre-wrap text-foreground">{comment.body}</span>
      </div>
    </div>
  );
}

/** A comment from the code reviewing agent, set apart from the person's own comments. */
function FindingNote({ finding, by, loose }: { finding: Finding; by: string; loose?: boolean }) {
  return (
    <div className={cn(NOTE, "border-active-dot/30 bg-active-bg")}>
      <BotIcon className="mt-0.5 size-3.5 shrink-0 text-active" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={WHO}>{`${by}${finding.line !== undefined ? (loose ? ` · line ${finding.line}, outside the diff` : ` · L${finding.line}`) : ""}`}</span>
        <div className={PROSE_TIGHT}>
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

/** Fold and gap rows: the page's sans font on the header fill. */
const FOLD = "bg-subtle font-sans text-xs text-muted-foreground";

function DiffTable({ file, mode, layout, selection, comments, earlier, findings, tokens, onSelect, onAdd, onCancel, onDraft, onRemove }: DiffProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const span = layout === "split" ? 6 : 4;
  const inSelection = (line: DiffLine | undefined, side: Side) => {
    const n = line && selection?.side === side ? numberOn(line, side) : undefined;
    return n !== undefined && n >= selection!.start && n <= selection!.end;
  };
  const endsHere = (line: DiffLine | undefined, side: Side, end: number) => !!line && numberOn(line, side) === end && (side === "new" ? line.kind !== "del" : line.kind !== "add");

  /** A full-width row under the code for a note or the composer. */
  const note = (key: string, child: ReactNode) => (
    <tr key={key}>
      <td colSpan={span} className="bg-card p-0 font-sans whitespace-normal">
        {child}
      </td>
    </tr>
  );

  /** Comments, last round's notes and the composer that belong under these lines. */
  const extras = (lines: DiffLine[]): ReactNode[] => {
    const at = (side: Side, end: number) => lines.some((l) => endsHere(l, side, end));
    const rows: ReactNode[] = [];
    for (const comment of comments.filter((c) => at(c.side, c.endLine ?? c.line)))
      rows.push(note(`comment:${comment.side}:${comment.line}:${comment.body}`, <InlineComment comment={comment} onRemove={onRemove && (() => onRemove(comment))} />));
    for (const placed of findings?.anchored.filter((f) => at("new", f.line)) ?? [])
      rows.push(note(`finding:${placed.line}:${placed.finding.body}`, <FindingNote finding={placed.finding} by={findings!.by} />));
    for (const placed of earlier.anchored.filter((e) => at("new", e.line))) rows.push(note(`earlier:${placed.line}:${placed.comment.body}`, <EarlierNote comment={placed.comment} />));
    if (selection && at(selection.side, selection.end))
      rows.push(
        note(
          "composer",
          <Composer label={`Comment on ${file.path} ${rangeLabel(selection.start, selection.end)}`} body={selection.draft} setBody={onDraft} onAdd={onAdd} onCancel={onCancel} />,
        ),
      );
    return rows;
  };

  const fold = (row: Extract<DiffRow, { kind: "fold" }>) => (
    <tr key={row.id} className={FOLD}>
      <td colSpan={span} className="p-0">
        <button type="button" className="flex w-full items-center gap-1.5 px-3 py-1 text-left hover:text-foreground" onClick={() => setExpanded((set) => new Set(set).add(row.id))}>
          <UnfoldVerticalIcon className="size-3.5" />
          {`Show ${row.lines.length} unmodified lines`}
        </button>
      </td>
    </tr>
  );
  const gap = (id: string) => (
    <tr key={id} className={FOLD}>
      <td colSpan={span} className="px-3 py-1">
        ⋯
      </td>
    </tr>
  );

  const rows = diffRows(file, { mode, expanded });
  return (
    <table className="shiki-code w-full table-fixed border-collapse border-t font-mono text-xs/[1.6]">
      <colgroup>
        {layout === "split" ? (
          <>
            <col className="w-11" />
            <col className="w-5" />
            <col />
            <col className="w-11" />
            <col className="w-5" />
            <col />
          </>
        ) : (
          <>
            <col className="w-11" />
            <col className="w-11" />
            <col className="w-5" />
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
                <tr key={`${line.kind}:${line.oldLine}:${line.newLine}`} className={cn(TONE[line.kind], selected && "bg-active-bg")}>
                  <LineNumber line={line} side="old" selected={inSelection(line, "old")} onSelect={onSelect} />
                  <LineNumber line={line} side="new" selected={inSelection(line, "new")} onSelect={onSelect} />
                  <td className={cn("pl-1.5 text-center align-top select-none", MARK_TONE[line.kind])}>{MARK[line.kind]}</td>
                  <td className="pr-3 pl-1 align-top break-all whitespace-pre-wrap">
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
                const tone = line ? (line.kind === "context" ? "" : TONE[line.kind]) : "bg-subtle";
                const picked = inSelection(line, side) && "bg-active-bg";
                return [
                  <LineNumber key={`${side}-n`} line={line} side={side} selected={inSelection(line, side)} onSelect={onSelect} />,
                  <td key={`${side}-m`} className={cn("pl-1.5 text-center align-top select-none", line ? MARK_TONE[line.kind] : "", tone, picked)}>
                    {line && line.kind !== "context" ? MARK[line.kind] : " "}
                  </td>,
                  <td key={`${side}-c`} className={cn("pr-3 pl-1 align-top break-all whitespace-pre-wrap", tone, picked)}>
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

function ViewedCheck({ index, viewed, onViewed }: { index: number; viewed: boolean; onViewed: (viewed: boolean) => void }) {
  const id = `review-viewed-${index}`;
  return (
    <span className="flex items-center gap-1.5">
      <Checkbox id={id} checked={viewed} onCheckedChange={(checked) => onViewed(checked === true)} className="size-[15px]" />
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        Viewed
      </Label>
    </span>
  );
}

/** A file's header: open or close it, its path and counts, how it changed, its findings and comments, and the viewed mark. */
function FileHeader({ index, open, onToggle, view, onViewed, file, comments, found }: Pick<FileDiffProps, "index" | "open" | "onToggle" | "view" | "onViewed" | "file" | "comments"> & { found: number }) {
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <header className="flex flex-wrap items-center gap-2.5 bg-subtle px-3 py-2 text-xs">
      <Button type="button" size="icon-xs" variant="ghost" className="-ml-1 text-muted-foreground" aria-label={`${open ? "Collapse" : "Expand"} ${file.path}`} aria-expanded={open} onClick={onToggle}>
        <Chevron />
      </Button>
      <span className="min-w-0 truncate font-mono font-medium">{file.path}</span>
      {file.oldPath && <span className="truncate font-mono text-muted-foreground">from {file.oldPath}</span>}
      <Button type="button" size="icon-xs" variant="ghost" className="-mx-1.5 text-muted-foreground" aria-label={`Copy ${file.path}`} onClick={() => void navigator.clipboard?.writeText(file.path)}>
        <CopyIcon />
      </Button>
      <span className="flex items-center gap-1.5 font-mono">
        <span className="text-success">{`+${file.additions}`}</span>
        <span className="text-danger">{`−${file.deletions}`}</span>
      </span>
      {file.status !== "modified" && <span className="inline-flex h-5 items-center rounded-[5px] bg-secondary px-[7px] text-[11px] font-medium text-secondary-foreground">{STATUS[file.status]}</span>}
      {found > 0 && (
        <span className="inline-flex h-5 items-center gap-1 rounded-[5px] border px-[7px] text-[11px] font-medium text-muted-foreground">
          <BotIcon className="size-[11px]" />
          {`${found} ${found === 1 ? "finding" : "findings"}`}
        </span>
      )}
      {comments.length > 0 && (
        <span className="flex items-center gap-1 text-muted-foreground" aria-label={`${comments.length} comments`}>
          <MessageSquareIcon className="size-3.5" />
          {comments.length}
        </span>
      )}
      {!view.viewed && view.reason && <span className="text-[11px] text-attention">{UNVIEWED[view.reason]}</span>}
      {onViewed && file.blob && (
        <span className="ml-auto">
          <ViewedCheck index={index} viewed={view.viewed} onViewed={onViewed} />
        </span>
      )}
    </header>
  );
}

/** One changed file: a header with its counts, comments and viewed mark, and its diff unless it is collapsed. */
export function FileDiff({ index, open, onToggle, view, onViewed, ...diff }: FileDiffProps) {
  const { file, comments, earlier, findings } = diff;
  const found = findings ? findings.anchored.length + findings.loose.length : 0;
  return (
    <section id={`review-file-${index}`} aria-label={file.path} className="scroll-mt-[120px] overflow-hidden rounded-lg border bg-card">
      <FileHeader index={index} open={open} onToggle={onToggle} view={view} onViewed={onViewed} file={file} comments={comments} found={found} />
      {open && findings?.loose.map((finding) => <FindingNote key={`loose:${finding.line}:${finding.body}`} finding={finding} by={findings.by} loose />)}
      {open && earlier.outdated.map((comment) => <EarlierNote key={`outdated:${comment.line}:${comment.body}`} comment={comment} outdated />)}
      {open &&
        (file.collapsed ? (
          <p className="border-t px-3 py-2 text-[13px] text-muted-foreground">{COLLAPSED[file.collapsed]}</p>
        ) : file.status === "binary" ? (
          <p className="border-t px-3 py-2 text-[13px] text-muted-foreground">Binary file.</p>
        ) : (
          <div className="overflow-x-auto">
            <DiffTable {...diff} />
          </div>
        ))}
    </section>
  );
}
