"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyIcon, MessageSquareIcon, MessageSquarePlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { quoteRanges } from "@/lib/quote-ranges";
import { usePageTools } from "@/lib/assistant/use-page-tools";
import { useReviewDraft } from "@/lib/use-review-draft";
import { CARD, PROSE } from "./styles";
import { SubmitReview, submitReviewTool } from "./submit-review";

type Comment = { quote: string; body: string };

const HIGHLIGHT = "review-comment";

/**
 * The highlight's colour. It lives here rather than in globals.css because Next's CSS pipeline
 * (Lightning CSS) does not know the ::highlight() pseudo-element and warns on every build; React
 * hoists this tag into the head once, unprocessed.
 */
const HIGHLIGHT_CSS = `::highlight(${HIGHLIGHT}) { background-color: color-mix(in oklab, var(--color-amber-300) 55%, transparent); }`;

/** Marks each commented passage with the CSS Custom Highlight API, where the browser has it. */
function useQuoteHighlights(root: React.RefObject<HTMLElement | null>, quotes: string[]) {
  useEffect(() => {
    if (!root.current || typeof CSS === "undefined" || !("highlights" in CSS) || typeof Highlight === "undefined") return;
    const ranges = quotes.flatMap((quote) => quoteRanges(root.current!, quote));
    CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
    return () => void CSS.highlights.delete(HIGHLIGHT);
  }, [root, quotes]);
}

function Composer({
  quote,
  inputRef,
  onAdd,
  onCancel,
}: {
  quote: string | undefined;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onAdd: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor="review-comment" className="text-[13px]">
        Comment
      </FieldLabel>
      {quote ? (
        <blockquote className="border-l-2 border-active-dot px-2.5 py-0.5 text-xs text-muted-foreground italic">&quot;{quote}&quot;</blockquote>
      ) : (
        <FieldDescription className="text-xs">Select text in the plan to comment on it.</FieldDescription>
      )}
      <Textarea ref={inputRef} id="review-comment" rows={3} value={body} disabled={!quote} onChange={(e) => setBody(e.target.value)} className="bg-subtle" />
      <div className="mt-1.5 flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!quote || !body.trim()}
          onClick={() => {
            onAdd(body.trim());
            setBody("");
          }}
        >
          <MessageSquarePlusIcon data-icon="inline-start" />
          Add comment
        </Button>
        {quote && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </Field>
  );
}

function CommentList({ comments, onRemove }: { comments: Comment[]; onRemove: (index: number) => void }) {
  if (comments.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{`${comments.length} ${comments.length === 1 ? "comment" : "comments"}`}</span>
      <ul aria-label="Comments" className="flex flex-col gap-1.5">
        {comments.map((comment, index) => (
          <li key={`${comment.quote}:${comment.body}`} className="flex items-start gap-2 rounded-lg border bg-subtle px-3 py-2.5 text-[13px]">
            <MessageSquareIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-xs text-muted-foreground italic">&quot;{comment.quote}&quot;</span>
              <span className="whitespace-pre-wrap">{comment.body}</span>
            </div>
            <Button type="button" size="icon-xs" variant="ghost" aria-label={`Remove comment on ${comment.quote}`} onClick={() => onRemove(index)}>
              <XIcon />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A passage a person selected, where it sits in the plan, and whether its comment and copy buttons still show. */
type Selected = { text: string; at?: { top: number; left: number }; bar: boolean };

/** Where a selection ends, relative to `root`, for buttons that sit just under it. Undefined where layout is unknown. */
function placeUnder(range: Range, root: HTMLElement) {
  if (typeof range.getBoundingClientRect !== "function") return undefined;
  const r = range.getBoundingClientRect();
  const box = root.getBoundingClientRect();
  return { top: r.bottom - box.top + 6, left: Math.max(0, r.left - box.left) };
}

/** The text a person selects inside `root`, kept until they select something else there. */
function useSelectedText(root: React.RefObject<HTMLElement | null>) {
  const [selected, setSelected] = useState<Selected>();
  useEffect(() => {
    const onChange = () => {
      const selection = document.getSelection();
      const text = selection?.toString().replace(/\s+/g, " ").trim();
      if (!text || !selection?.anchorNode || !root.current?.contains(selection.anchorNode)) return;
      const at = selection.rangeCount > 0 ? placeUnder(selection.getRangeAt(0), root.current) : undefined;
      setSelected({ text, bar: true, ...(at ? { at } : {}) });
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [root]);
  return [selected, setSelected] as const;
}

/** A quote as a selection gives it: runs of whitespace are one space. */
const normalize = (quote: string) => quote.replace(/\s+/g, " ").trim();
const commentCount = (n: number) => `${n} ${n === 1 ? "comment" : "comments"} drafted`;

/** Buttons under a selection: comment on it in the side panel, or copy it. */
function SelectionBar({ selected, onComment }: { selected: Selected; onComment: () => void }) {
  // Pressing a button must not clear the selection it acts on.
  const keep = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div
      role="toolbar"
      aria-label="Selection"
      style={selected.at ? { top: selected.at.top, left: selected.at.left } : undefined}
      className="absolute z-10 inline-flex gap-0.5 rounded-md border border-input bg-popover p-0.5 text-xs text-popover-foreground shadow-md"
    >
      <Button type="button" size="xs" variant="ghost" onMouseDown={keep} onClick={onComment}>
        <MessageSquarePlusIcon data-icon="inline-start" />
        Comment
      </Button>
      <Button type="button" size="xs" variant="ghost" onMouseDown={keep} onClick={() => void navigator.clipboard?.writeText(selected.text)}>
        <CopyIcon data-icon="inline-start" />
        Copy
      </Button>
    </div>
  );
}

/**
 * A human gate's review: what reached the gate as markdown, comments on selected passages, and an
 * overall comment with request changes, approve, or approve after fixes. Comments go back with every quote.
 */
export function PlanReview({ questionId, runId, from, markdown }: { questionId: string; runId: string; from: string; markdown: string }) {
  const article = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [selected, setSelected] = useSelectedText(article);
  const { comments, setComments, note, setNote, onSending, onFailed } = useReviewDraft<Comment>(questionId);
  useQuoteHighlights(article, comments.map((c) => c.quote));

  usePageTools(
    "plan_review",
    {
      page_comment_on_passage: ({ quote: given, body }) => {
        const quote = normalize(given);
        // The plan as the page shows it, where a person's selection comes from and the highlight looks.
        if (!article.current || quoteRanges(article.current, quote).length === 0) throw new Error(`"${quote}" is not in the plan. Quote the plan's text as the page shows it, without markdown.`);
        setComments((list) => [...list, { quote, body }]);
        return `Drafted a comment on "${quote}". ${commentCount(comments.length + 1)}.`;
      },
      page_remove_comment: ({ quote: given }) => {
        const quote = normalize(given);
        if (!comments.some((c) => c.quote === quote)) {
          const drafted = comments.map((c) => `"${c.quote}"`);
          throw new Error(`No drafted comment is on "${quote}". ${drafted.length ? `The drafted comments are on: ${drafted.join("; ")}.` : "No comments are drafted."}`);
        }
        setComments((list) => {
          const first = list.findIndex((c) => c.quote === quote);
          return list.filter((_, i) => i !== first);
        });
        return `Removed the comment on "${quote}". ${commentCount(comments.length - 1)}.`;
      },
      page_set_note: ({ note: next }) => {
        setNote(next);
        return next.trim() ? `Set the overall comment to "${next}"` : "Cleared the overall comment.";
      },
      page_submit_review: ({ option }) => submitReviewTool({ questionId, runId, option, note, comments, target: from, onSending, onFailed }),
    },
    () => ({ questionId, runId, from, comments, note }),
  );

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <style href="review-comment-highlight" precedence="default">
        {HIGHLIGHT_CSS}
      </style>
      <div className="relative">
        <article ref={article} className={`${CARD} ${PROSE} px-8 py-7`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </article>
        {selected?.bar && (
          <SelectionBar
            selected={selected}
            onComment={() => {
              setSelected((s) => s && { ...s, bar: false });
              input.current?.focus();
            }}
          />
        )}
      </div>
      <aside className="flex flex-col gap-4 lg:sticky lg:top-[76px]">
        <div className={`${CARD} px-5 py-4`}>
          <Composer
            key={selected?.text}
            quote={selected?.text}
            inputRef={input}
            onAdd={(body) => {
              setComments((list) => [...list, { quote: selected!.text, body }]);
              setSelected(undefined);
            }}
            onCancel={() => setSelected(undefined)}
          />
        </div>
        <CommentList comments={comments} onRemove={(index) => setComments((list) => list.filter((_, i) => i !== index))} />
        <div className={`${CARD} px-5 py-4`}>
          <SubmitReview questionId={questionId} runId={runId} target={from} comments={comments} note={note} setNote={setNote} onSending={onSending} onFailed={onFailed} />
        </div>
      </aside>
    </div>
  );
}
