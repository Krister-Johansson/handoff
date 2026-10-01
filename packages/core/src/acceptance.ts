import type { RunState } from "./schema/run-state.ts";

const CHECKBOX = /^\s*[-*+]\s+\[[ xX]\]\s+(.+?)\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const ACCEPTANCE_HEADING = /acceptance|criteria|definition of done/i;

/** Markdown emphasis and code marks dropped, so a criterion reads as a plain sentence. */
const plain = (text: string) => text.replace(/(\*\*|__|\*|_|`)(.+?)\1/g, "$2").trim();

/**
 * The acceptance criteria an issue lists: the checkboxes under a heading that names acceptance criteria
 * or a definition of done, or every checkbox in the issue when it has no such heading.
 */
export function criteriaInIssue(body: string): string[] {
  const lines = body.split("\n");
  const sectioned: string[] = [];
  const all: string[] = [];
  let inSection = false;
  let sawSection = false;
  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading) {
      inSection = ACCEPTANCE_HEADING.test(heading[1]!);
      sawSection ||= inSection;
      continue;
    }
    const box = CHECKBOX.exec(line);
    if (!box) continue;
    all.push(plain(box[1]!));
    if (inSection) sectioned.push(plain(box[1]!));
  }
  return sawSection ? sectioned : all;
}

/** What a person can check in the running app to see the task is done, and where the list came from. */
export type Acceptance = { source: "issue" | "planner"; items: string[] };

/** A run's acceptance criteria: its issues' checkboxes when they have any, otherwise the planner's list. */
export function acceptanceOf(state: Pick<RunState, "issues" | "plan">): Acceptance | undefined {
  const fromIssues = (state.issues ?? []).flatMap((issue) => criteriaInIssue(issue.body));
  if (fromIssues.length) return { source: "issue", items: fromIssues };
  const planned = state.plan?.acceptance ?? [];
  return planned.length ? { source: "planner", items: planned } : undefined;
}
