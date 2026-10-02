import type { ReactNode } from "react";

/**
 * The page's two columns. In the DOM the first section comes first, then the rail, then the rest, so
 * below 1024 px the order reads: header, the first section, where the issue sits, the description and
 * the comments. From 1024 px the rail moves to the right of all of them.
 */
export function IssueColumns({ first, rail, rest }: { first: ReactNode; rail: ReactNode; rest: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-4 [grid-template-areas:'first'_'rail'_'rest'] lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr] lg:[grid-template-areas:'first_rail'_'rest_rail']">
      <div className="flex min-w-0 flex-col gap-4 [grid-area:first] empty:hidden">{first}</div>
      {rail}
      <div className="flex min-w-0 flex-col gap-4 [grid-area:rest] lg:self-start">{rest}</div>
    </div>
  );
}
