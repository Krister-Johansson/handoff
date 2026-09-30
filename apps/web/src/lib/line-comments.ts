import type { DiffLine } from "@handoff/core";

/** Which version of a file a line comment points into: the branch's ("new") or the base's ("old"). */
export type Side = "old" | "new";
/** A comment on lines of a changed file, sent back with the review. */
export type LineComment = {
  path: string;
  side: Side;
  line: number;
  endLine?: number;
  quote: string;
  body: string;
};
/** Lines a person picked with click and shift-click; `anchor` is where the range started, `draft` the comment being typed. */
export type LineSelection = {
  path: string;
  side: Side;
  anchor: number;
  start: number;
  end: number;
  draft: string;
};

export const numberOn = (line: DiffLine, side: Side) => (side === "new" ? line.newLine : line.oldLine);
export const rangeLabel = (start: number, end: number) => (start === end ? `line ${start}` : `lines ${start}–${end}`);

