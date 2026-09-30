"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MessageSquarePlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { quoteRanges } from "@/lib/quote-ranges";
import { SubmitReview } from "./submit-review";

type Comment = { quote: string; body: string };

const HIGHLIGHT = "review-comment";

/** Marks each commented passage with the CSS Custom Highlight API, where the browser has it. */
function useQuoteHighlights(root: React.RefObject<HTMLElement | null>, quotes: string[]) {
  useEffect(() => {
    if (!root.current || typeof CSS === "undefined" || !("highlights" in CSS) || typeof Highlight === "undefined") return;
    const ranges = quotes.flatMap((quote) => quoteRanges(root.current!, quote));
    CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
    return () => void CSS.highlights.delete(HIGHLIGHT);
  }, [root, quotes]);
}

function Composer({ quote, onAdd, onCancel }: { quote: string | undefined; onAdd: (body: string) => void; onCancel: () => void }) {
  const [body, setBody] = useState("");
  return (
    <Field>
      <FieldLabel htmlFor="review-comment">Comment</FieldLabel>
      {quote ? <blockquote className="border-l-2 pl-2 text-xs text-muted-foreground">&quot;{quote}&quot;</blockquote> : <FieldDescription>Select text in the plan to comment on it.</FieldDescription>}
      <Textarea id="review-comment" rows={3} value={body} disabled={!quote} onChange={(e) => setBody(e.target.value)} />
      <div className="flex gap-2">
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
    <ul aria-label="Comments" className="flex flex-col gap-2">
      {comments.map((comment, index) => (
        <li key={`${comment.quote}:${comment.body}`} className="flex items-start gap-2 rounded-md border p-2 text-sm">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-xs text-muted-foreground">&quot;{comment.quote}&quot;</span>
            <span>{comment.body}</span>
          </div>
          <Button type="button" size="icon-xs" variant="ghost" aria-label={`Remove comment on ${comment.quote}`} onClick={() => onRemove(index)}>
            <XIcon />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** The text a person selects inside `root`, kept until they select something else there. */
function useSelectedText(root: React.RefObject<HTMLElement | null>) {
  const [selected, setSelected] = useState<string>();
  useEffect(() => {
    const onChange = () => {
      const selection = document.getSelection();
      const text = selection?.toString().replace(/\s+/g, " ").trim();
      if (text && selection?.anchorNode && root.current?.contains(selection.anchorNode)) setSelected(text);
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [root]);
  return [selected, setSelected] as const;
}

/**
 * A human gate's review: what reached the gate as markdown, comments on selected passages, and an
 * overall comment with request changes, approve, or approve after fixes. Comments go back with every quote.
 */
export function PlanReview({ questionId, runId, from, markdown }: { questionId: string; runId: string; from: string; markdown: string }) {
  const article = useRef<HTMLElement>(null);
  const [selected, setSelected] = useSelectedText(article);
  const [comments, setComments] = useState<Comment[]>([]);
  useQuoteHighlights(article, comments.map((c) => c.quote));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <article ref={article} className="prose prose-sm max-w-none rounded-lg border p-6 dark:prose-invert prose-code:before:content-none prose-code:after:content-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </article>
      <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
        <Composer
          key={selected}
          quote={selected}
          onAdd={(body) => {
            setComments((list) => [...list, { quote: selected!, body }]);
            setSelected(undefined);
          }}
          onCancel={() => setSelected(undefined)}
        />
        <CommentList comments={comments} onRemove={(index) => setComments((list) => list.filter((_, i) => i !== index))} />
        <SubmitReview questionId={questionId} runId={runId} target={from} comments={comments} />
      </aside>
    </div>
  );
}
