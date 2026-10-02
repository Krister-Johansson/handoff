import type { BacklogIssue } from "@/server/backlog";
import type { PlanColumn, PlanEpic, PlanStory, PlanTask } from "@/server/plan";
import type { NarrowedPlan } from "./filters";

type Searchable = { number: number; title: string };
type Plan = Pick<NarrowedPlan, "epics" | "unparented" | "unplanned" | "board">;

const NUMBER = /^#?(\d+)$/;

/**
 * Whether an item matches the search: its title holds the text, ignoring case, or, when the text is a
 * number with or without #, its number starts with those digits (#5 finds #52 to #59).
 */
export function matchesQuery(item: Searchable, q: string): boolean {
  const text = q.trim().toLowerCase();
  if (!text) return false;
  const digits = NUMBER.exec(text)?.[1];
  return (digits !== undefined && String(item.number).startsWith(digits)) || item.title.toLowerCase().includes(text);
}

export type SearchResult = Plan & {
  /** Whether a search is under way. */
  active: boolean;
  /** Collapse keys the search opens because a match sits under them: e12, s41, unparented, unplanned. Never stored. */
  open: Set<string>;
  /** Per epic, how many of its tasks the search hides. */
  hidden: Record<number, number>;
  /** What matched: rows in the tree, cards on the board, rows in the timeline. */
  matches: { tree: number; board: number; timeline: number };
};

/** A story narrowed by the search: kept whole and closed when it matches with nothing under it matching, otherwise only its matching tasks. */
function searchStory(story: PlanStory, q: string, open: Set<string>) {
  const tasks = story.tasks.filter((t) => matchesQuery(t, q));
  const self = matchesQuery(story, q);
  if (tasks.length > 0) open.add(`s${story.number}`);
  else if (!self) return { story: undefined, matched: 0 };
  return { story: { ...story, tasks: tasks.length > 0 ? tasks : story.tasks }, matched: tasks.length + (self ? 1 : 0) };
}

function searchEpic(epic: PlanEpic, q: string, open: Set<string>) {
  const stories: PlanStory[] = [];
  let matched = 0;
  for (const s of epic.stories) {
    const found = searchStory(s, q, open);
    if (found.story) stories.push(found.story);
    matched += found.matched;
  }
  const tasks = epic.tasks.filter((t) => matchesQuery(t, q));
  matched += tasks.length;
  const self = matchesQuery(epic, q);
  if (matched > 0) open.add(`e${epic.number}`);
  else if (!self) return { epic: undefined, matched: 0 };
  const kept = matched > 0 ? { ...epic, stories, tasks } : epic;
  return { epic: kept, matched: matched + (self ? 1 : 0) };
}

const taskCount = (epic: PlanEpic) => epic.stories.reduce((n, s) => n + s.tasks.length, epic.tasks.length);

/**
 * The plan narrowed further by the search, for the tree, the board and the timeline. A row shows when
 * it matches or a row under it matches, and the rows above a match open; a matching epic or story with
 * no match under it keeps all its rows and stays closed. A board card shows when its task, its story
 * or its epic matches. The open rows are the search's own: nothing is written to the collapse store.
 */
export function searchPlan(plan: Plan, q: string): SearchResult {
  const text = q.trim();
  if (!text) return { ...plan, active: false, open: new Set(), hidden: {}, matches: { tree: 0, board: 0, timeline: 0 } };
  const open = new Set<string>();
  const hidden: Record<number, number> = {};
  const epics: PlanEpic[] = [];
  let timeline = 0;
  for (const e of plan.epics) {
    const found = searchEpic(e, text, open);
    if (!found.epic) continue;
    epics.push(found.epic);
    timeline += found.matched;
    const gone = taskCount(e) - taskCount(found.epic);
    if (gone > 0) hidden[e.number] = gone;
  }
  const unparented = plan.unparented.filter((t) => matchesQuery(t, text));
  const unplanned: BacklogIssue[] = plan.unplanned.filter((i) => matchesQuery(i, text));
  if (unparented.length) open.add("unparented");
  if (unplanned.length) open.add("unplanned");
  timeline += unparented.length;

  // A card's story and epic, so a card shows when either matches.
  const parents = new Map<number, Searchable[]>();
  for (const e of plan.epics) {
    for (const s of e.stories) for (const t of s.tasks) parents.set(t.number, [s, e]);
    for (const t of e.tasks) parents.set(t.number, [e]);
  }
  const onBoard = (t: PlanTask) => matchesQuery(t, text) || (parents.get(t.number) ?? []).some((p) => matchesQuery(p, text));
  const board = Object.fromEntries(Object.entries(plan.board).map(([column, tasks]) => [column, tasks.filter(onBoard)])) as Record<PlanColumn, PlanTask[]>;
  const cards = Object.values(board).reduce((n, tasks) => n + tasks.length, 0);

  return { epics, unparented, unplanned, board, active: true, open, hidden, matches: { tree: timeline + unplanned.length, board: cards, timeline } };
}

/** A piece of a title or a number, and whether the search found it. */
export type MatchPart = { text: string; hit: boolean };

/** Splits text around what the search found in it: every place a title holds the text, or the digits a number starts with. */
export function matchParts(text: string, q: string): MatchPart[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [{ text, hit: false }];
  const digits = NUMBER.exec(needle)?.[1];
  if (digits !== undefined && /^#\d+$/.test(text)) {
    const end = text.slice(1).startsWith(digits) ? digits.length + 1 : 0;
    return end ? [{ text: text.slice(0, end), hit: true }, ...(end < text.length ? [{ text: text.slice(end), hit: false }] : [])] : [{ text, hit: false }];
  }
  const parts: MatchPart[] = [];
  const lower = text.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, at)) {
    if (i > at) parts.push({ text: text.slice(at, i), hit: false });
    parts.push({ text: text.slice(i, i + needle.length), hit: true });
    at = i + needle.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}
