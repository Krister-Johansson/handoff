import type { SearchPage } from "./pages";
import type { SearchChat, SearchRecords, SearchRun, SearchTask, SearchTasks } from "./types";

/** The filter chips of search, in Tab order. */
export const SEARCH_FILTERS = ["all", "tasks", "runs", "pages", "chats"] as const;
export type SearchFilter = (typeof SEARCH_FILTERS)[number];

/** A query split into its prefix, # for tasks or / for pages, and the term after it. */
export type ParsedQuery = { prefix: "#" | "/" | null; term: string };

/** Reads the # and / prefixes before anything matches: "#4" is the term 4 among tasks, "/sett" the term sett among pages. */
export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trimStart();
  const first = trimmed.charAt(0);
  if (first === "#" || first === "/") return { prefix: first, term: trimmed.slice(1).trim() };
  return { prefix: null, term: raw.trim() };
}

/**
 * What part of a hit matched: `title` is the [start, end) of the term in its title, null when only
 * something else matched (a branch, a short id, a trail); `number` is how many leading digits of a
 * task's number matched after #.
 */
export type SearchMatch = { title: [number, number] | null; number: number };

export type SearchHit =
  | { kind: "task"; key: string; task: SearchTask; match: SearchMatch }
  | { kind: "run"; key: string; run: SearchRun; match: SearchMatch }
  | { kind: "page"; key: string; page: SearchPage; match: SearchMatch }
  | { kind: "chat"; key: string; chat: SearchChat; match: SearchMatch };

type Kind = SearchHit["kind"];
/** A group of results: one per kind, then Other projects for what other projects hold. */
export type GroupId = "tasks" | "runs" | "pages" | "chats" | "other";
/** `total` hits match; `hits` are those shown, and `hidden` how many Show more adds. */
export type ResultGroup = { id: GroupId; total: number; hits: SearchHit[]; hidden: number };

export type SearchData = {
  records: SearchRecords;
  /** Undefined until GitHub's answer arrives. */
  tasks: SearchTasks | undefined;
  pages: SearchPage[];
  /** Search covers every project: other projects' results join their groups instead of Other projects. */
  all?: boolean;
};

/** How many results each group shows in All before Show more. */
export const GROUP_CAP = 3;

const FILTER_OF_KIND: Record<Kind, Exclude<SearchFilter, "all">> = { task: "tasks", run: "runs", page: "pages", chat: "chats" };
const OTHER_ORDER: Record<Kind, number> = { task: 0, run: 1, chat: 2, page: 3 };

/** How well `term` matches: 3 when the title starts with it, 2 at a word start in the title, 1 inside the title, 0.5 in the rest; undefined when a word is missing. */
function scoreOf(title: string, rest: string[], term: string): { score: number; match: SearchMatch } | undefined {
  const lowTitle = title.toLowerCase();
  const low = term.toLowerCase();
  const words = low.split(/\s+/).filter(Boolean);
  const haystack = [lowTitle, ...rest.map((r) => r.toLowerCase())].join(" ");
  if (!words.every((w) => haystack.includes(w))) return undefined;
  const whole = lowTitle.indexOf(low);
  const at = whole >= 0 ? whole : lowTitle.indexOf(words[0]!);
  const length = whole >= 0 ? low.length : words[0]!.length;
  if (at < 0) return { score: 0.5, match: { title: null, number: 0 } };
  const wordStart = at === 0 || /[\s\-_/(]/.test(lowTitle.charAt(at - 1));
  const score = whole === 0 ? 3 : wordStart ? 2 : 1;
  return { score, match: { title: [at, at + length], number: 0 } };
}

type Scored = { hit: SearchHit; score: number };
/** A result without the part of the query it matched, as Recent keeps it. */
export type SearchItem = { [K in Kind]: Omit<Extract<SearchHit, { kind: K }>, "match"> }[Kind];

/** Every hit of the data for the term, best first within each kind; `prefix` # matches task numbers by their leading digits. */
function hitsOf(data: SearchData, { prefix, term }: ParsedQuery): Scored[] {
  const scored: Scored[] = [];
  const add = (hit: SearchItem, title: string, rest: string[]) => {
    if (!term) {
      scored.push({ hit: { ...hit, match: { title: null, number: 0 } } as SearchHit, score: 0 });
      return;
    }
    const found = scoreOf(title, rest, term);
    if (found) scored.push({ hit: { ...hit, match: found.match } as SearchHit, score: found.score });
  };
  if (prefix !== "/") {
    for (const task of data.tasks?.tasks ?? []) {
      const key = `task:${task.projectId}:${task.number}`;
      if (prefix === "#" && /^\d+$/.test(term)) {
        if (String(task.number).startsWith(term)) scored.push({ hit: { kind: "task", key, task, match: { title: null, number: term.length } }, score: 0 });
      } else add({ kind: "task", key, task }, task.title, [`#${task.number}`]);
    }
  }
  if (prefix === null) {
    for (const run of data.records.runs) add({ kind: "run", key: `run:${run.id}`, run }, run.title, [run.shortId, run.branch, ...run.issues.map((n) => `#${n}`)]);
    for (const chat of data.records.chats) add({ kind: "chat", key: `chat:${chat.id}`, chat }, chat.title, []);
  }
  if (prefix !== "#") for (const page of data.pages) add({ kind: "page", key: page.id, page }, page.label, [page.trail]);
  // Stable: equal scores keep the data's order (tasks by number, runs and chats newest first, pages as listed).
  return scored.sort((a, b) => b.score - a.score);
}

const projectOf = (hit: SearchHit): string | null => {
  switch (hit.kind) {
    case "task":
      return hit.task.projectId;
    case "run":
      return hit.run.projectId;
    case "chat":
      return hit.chat.projectId;
    case "page":
      return hit.page.projectId;
  }
};

/**
 * Search's results for a query: the filter it shows (# means Tasks and / Pages, whatever chip is on), the
 * count of each filter, and the groups. In All each group shows 3 with Show more unless `expanded` names
 * it; a filter shows its kind in full. Outside All projects, what another project holds goes under Other
 * projects. An empty query finds nothing in All, and lists the whole kind under a filter.
 */
export function searchResults(
  data: SearchData,
  raw: string,
  opts: { filter?: SearchFilter; expanded?: ReadonlySet<GroupId> } = {},
): { filter: SearchFilter; counts: Record<SearchFilter, number>; groups: ResultGroup[] } {
  const query = parseQuery(raw);
  const filter: SearchFilter = query.prefix === "#" ? "tasks" : query.prefix === "/" ? "pages" : (opts.filter ?? "all");
  const counts: Record<SearchFilter, number> = { all: 0, tasks: 0, runs: 0, pages: 0, chats: 0 };
  if (!query.prefix && !query.term && filter === "all") return { filter, counts, groups: [] };
  const hits = hitsOf(data, query);
  for (const { hit } of hits) {
    counts[FILTER_OF_KIND[hit.kind]]++;
    counts.all++;
  }
  const isOther = (hit: SearchHit) => !data.all && projectOf(hit) !== null && projectOf(hit) !== data.records.projectId;
  const shown = hits.filter(({ hit }) => filter === "all" || FILTER_OF_KIND[hit.kind] === filter);
  const byGroup = new Map<GroupId, SearchHit[]>();
  for (const { hit } of shown) {
    const id: GroupId = isOther(hit) ? "other" : FILTER_OF_KIND[hit.kind];
    byGroup.set(id, [...(byGroup.get(id) ?? []), hit]);
  }
  const order: GroupId[] = ["tasks", "runs", "pages", "chats", "other"];
  const groups = order.flatMap((id) => {
    const all = byGroup.get(id);
    if (!all) return [];
    const sorted = id === "other" ? [...all].sort((a, b) => OTHER_ORDER[a.kind] - OTHER_ORDER[b.kind]) : all;
    const capped = filter === "all" && !opts.expanded?.has(id) && sorted.length > GROUP_CAP;
    return [{ id, total: sorted.length, hits: capped ? sorted.slice(0, GROUP_CAP) : sorted, hidden: capped ? sorted.length - GROUP_CAP : 0 }];
  });
  return { filter, counts, groups };
}
