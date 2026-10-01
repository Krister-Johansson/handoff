/** Rendered markdown on the review pages: the design's reading sizes, code on a soft fill, no backtick quotes. */
export const PROSE =
  "prose prose-sm max-w-none text-sm/[1.6] text-foreground dark:prose-invert prose-headings:font-semibold prose-headings:text-foreground prose-h1:mt-0 prose-h1:mb-3 prose-h1:text-xl prose-h1:tracking-[-0.01em] prose-h2:mt-[22px] prose-h2:mb-2 prose-h2:text-base prose-h3:mt-4 prose-h3:mb-1.5 prose-h3:text-sm prose-p:my-0 prose-p:mb-2.5 prose-ul:my-0 prose-ul:mb-2.5 prose-ol:my-0 prose-ol:mb-2.5 prose-li:my-0.5 prose-code:rounded prose-code:bg-muted prose-code:px-[5px] prose-code:py-px prose-code:font-mono prose-code:text-xs prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-pre:my-0 prose-pre:mb-2.5 prose-pre:rounded-md prose-pre:border prose-pre:bg-subtle prose-pre:px-3 prose-pre:py-2.5 prose-pre:text-xs prose-pre:text-foreground [&_pre_code]:bg-transparent [&_pre_code]:p-0";

/** Markdown inside a comment or a finding: the same, with no gaps above or below. */
export const PROSE_TIGHT = `${PROSE} text-[13px]/[1.5] prose-p:mb-0 [&>*+*]:mt-1.5`;

/** A card on the review pages. */
export const CARD = "rounded-xl border bg-card text-card-foreground";
