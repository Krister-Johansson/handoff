"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { ChevronDownIcon, ChevronsDownIcon, CloudOffIcon, ExternalLinkIcon, LayersIcon, RotateCwIcon, SearchIcon, SearchXIcon } from "lucide-react";
import { ProjectTile } from "@/components/assistant/chat-bits";
import { useOptionalVoice } from "@/components/voice/voice-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Command, CommandDialog, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { DialogClose } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { searchPages, type SearchPage } from "@/lib/search/pages";
import { readRecent } from "@/lib/search/recent";
import { parseQuery, searchResults, SEARCH_FILTERS, type GroupId, type SearchFilter, type SearchHit, type SearchItem } from "@/lib/search/results";
import type { SearchProject, SearchRecords, SearchTasks } from "@/lib/search/types";
import { cn } from "@/lib/utils";
import { ActionRow, HitRow, type RowContext } from "./search-rows";

const FILTER_LABEL: Record<SearchFilter, string> = { all: "All", tasks: "Tasks", runs: "Runs", pages: "Pages", chats: "Chats" };
const FILTER_PREFIX: Partial<Record<SearchFilter, string>> = { tasks: "#", pages: "/" };
const ACTIVE = new Set(["queued", "running", "waiting"]);
const NO_RECORDS: SearchRecords = { projectId: null, projects: [], runs: [], chats: [] };
const GROUP_NOUN: Record<GroupId | "issues", [string, string]> = {
  tasks: ["task", "tasks"],
  issues: ["issue", "issues"],
  runs: ["run", "runs"],
  pages: ["page", "pages"],
  chats: ["chat", "chats"],
  other: ["result", "results"],
};

/** One row of the list: what it shows and what Enter (or Cmd+Enter, `newTab`) does with it. */
type Row = { key: string; body: ReactNode; run: (newTab: boolean) => void };
/** A group of rows under a heading with a count; a note above the rows, or loading rows in their place. */
type Section = { id: string; heading?: string; count?: string; note?: ReactNode; loading?: boolean; rows: Row[] };

export type SearchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fills the screen with Cancel in place of Esc, as on a phone. */
  phone: boolean;
  records: SearchRecords | undefined;
  /** Undefined until GitHub's answer arrives. */
  tasks: SearchTasks | undefined;
  /** Search covers every project. */
  all: boolean;
  /** Search keeps to its project: other projects' results wait for All projects instead of showing under Other projects. */
  onlyProject: boolean;
  /** The project of the open page, which the project menu calls This project. */
  pageProjectId: string | undefined;
  onPickProject: (projectId: string) => void;
  onAllProjects: () => void;
  onRetryTasks: () => void;
  onOpenHit: (hit: SearchHit | SearchItem, newTab: boolean) => void;
};

const plural = (n: number, [one, many]: [string, string]) => `${n} ${n === 1 ? one : many}`;
const andList = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const action = (key: string, body: ReactNode, run: () => void): Row => ({ key, body, run: () => run() });

/** Before a query: Recent, the project's active runs, and a few places to go. */
function startSections({ records, pages, recent, hitRow }: { records: SearchRecords; pages: SearchPage[]; recent: SearchItem[]; hitRow: (hit: SearchItem) => Row }): Section[] {
  const sections: Section[] = [];
  if (recent.length) sections.push({ id: "recent", heading: "Recent", rows: recent.map(hitRow) });
  const active = records.runs.filter((r) => r.projectId === records.projectId && ACTIVE.has(r.status));
  if (active.length) sections.push({ id: "active", heading: "Active runs", count: String(active.length), rows: active.map((run) => hitRow({ kind: "run", key: `run:${run.id}`, run })) });
  const inProject = records.projects.some((p) => p.current);
  const goTo = (inProject ? ["page:runs", "page:plan", "page:inbox", "page:settings"] : ["page:inbox", "page:chats", "page:settings"]).flatMap((id) => pages.filter((p) => p.id === id));
  if (goTo.length) sections.push({ id: "goto", heading: "Go to", rows: goTo.map((page) => hitRow({ kind: "page", key: page.id, page })) });
  return sections;
}

type ResultInput = {
  result: ReturnType<typeof searchResults>;
  tasks: SearchTasks | undefined;
  term: string;
  /** The filter shows tasks. */
  tasksShown: boolean;
  all: boolean;
  ctx: RowContext;
  hitRow: (hit: SearchHit) => Row;
  onExpand: (id: GroupId) => void;
  onRetryTasks: () => void;
  onAllProjects: () => void;
};

/** The Tasks group's notice and Try GitHub again when GitHub did not answer, added to the group or as one of its own. */
function addTasksNotice(sections: Section[], { tasks, all, ctx, onRetryTasks }: ResultInput) {
  const failed = (tasks?.sources ?? []).flatMap((s) => (s.source === "runs" ? [{ name: ctx.projects.get(s.projectId)?.name ?? s.repo, error: s.error ?? "" }] : []));
  if (!failed.length) return;
  const note = <TasksNote failed={failed} all={all} />;
  const retry = action("retry", <ActionRow icon={<RotateCwIcon />} title="Try GitHub again" quiet />, onRetryTasks);
  const existing = sections.find((s) => s.id === "tasks");
  if (existing) Object.assign(existing, { note, rows: [...existing.rows, retry] });
  else sections.unshift({ id: "tasks", heading: "Tasks", note, rows: [retry] });
}

/**
 * The results of a query in groups, each with its heading, count and Show more. Loading rows stand for
 * Tasks until GitHub answers. Other projects offers Search all projects; no results offers it and the
 * issue search on GitHub, with a message for each.
 */
function resultSections(input: ResultInput): { sections: Section[]; message: string | undefined; none: boolean } {
  const { result, tasks, term, tasksShown, all, ctx, hitRow, onExpand, onAllProjects } = input;
  const sources = tasks?.sources ?? [];
  const failed = sources.some((s) => s.source === "runs");
  const issuesOnly = sources.length > 0 && sources.every((s) => s.source === "issues");
  const current = [...ctx.projects.values()].find((p) => p.current);
  const others = [...ctx.projects.values()].filter((p) => !p.current);
  const headingOf = (id: GroupId) => (id === "other" ? "Other projects" : id === "tasks" && issuesOnly ? "Issues" : FILTER_LABEL[id]);
  const sections: Section[] = tasksShown && !tasks ? [{ id: "tasks", heading: "Tasks", loading: true, rows: [] }] : [];
  for (const group of result.groups) {
    const rows = group.hits.map(hitRow);
    const noun = GROUP_NOUN[group.id === "tasks" && issuesOnly ? "issues" : group.id];
    if (group.hidden) rows.push(action(`more:${group.id}`, <ActionRow icon={<ChevronsDownIcon />} title={`Show ${plural(group.hidden, noun).replace(/^(\d+)/, "$1 more")}`} quiet />, () => onExpand(group.id)));
    sections.push({ id: group.id, heading: headingOf(group.id), count: group.hidden ? `${group.hits.length} of ${group.total}` : String(group.total), rows });
  }
  if (tasksShown && tasks) addTasksNotice(sections, input);
  const searchAll = (title: string, sub: string) => action("all", <ActionRow icon={<LayersIcon />} title={title} sub={sub} />, onAllProjects);
  const hasOther = result.groups.some((g) => g.id === "other");
  const onlyOther = hasOther && result.groups.length === 1;
  const none = !result.groups.length && !!tasks && !failed && !!term;
  if (hasOther && !all) sections.push({ id: "search-all", rows: [searchAll(`Search all projects for "${term}"`, "Adds their tasks from GitHub")] });
  // Search kept to its project offers what other projects hold, unless no results offer it below.
  else if (result.elsewhere && !all && !none) sections.push({ id: "search-all", rows: [searchAll(`Search all projects for "${term}"`, `${result.elsewhere} more in other projects`)] });
  const message = onlyOther && !failed && tasks ? `Nothing in ${current?.name ?? "this project"} matches "${term}".` : undefined;
  if (none) {
    const rows: Row[] = [];
    if (!all && others.length) rows.push(searchAll("Search all projects", `${andList(others.map((p) => p.name))} too`));
    if (current) {
      const href = `https://github.com/${current.repo}/issues?q=${encodeURIComponent(term)}`;
      rows.push(action("github", <ActionRow icon={<ExternalLinkIcon />} title="Search issues on GitHub" sub={`${current.repo}, in a new tab`} />, () => window.open(href, "_blank", "noopener")));
    }
    sections.push({ id: "none-actions", rows });
  }
  return { sections, message, none };
}


/**
 * The query and the filter it shows. Tab and Shift+Tab move between the filters; Esc clears the query and
 * the filter, and once both are clear leaves Esc to the dialog, which closes. While voice speaks or listens,
 * Esc is voice's.
 */
function useSearchQuery() {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<SearchFilter>("all");
  const [expanded, setExpanded] = useState<ReadonlySet<GroupId>>(new Set());
  const voice = useOptionalVoice();
  const parsed = parseQuery(query);

  const changeQuery = (next: string) => {
    setQuery(next);
    setExpanded(new Set());
  };
  const changeFilter = (next: SearchFilter) => {
    if (parsed.prefix) setQuery(parsed.term);
    setChosen(next);
    setExpanded(new Set());
  };
  const tabFrom = (filter: SearchFilter) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
    // Focus stays in the input: Tab changes the filter, and the dialog's focus trap does not see the key.
    e.preventDefault();
    e.stopPropagation();
    const at = SEARCH_FILTERS.indexOf(filter);
    changeFilter(SEARCH_FILTERS[(at + (e.shiftKey ? -1 : 1) + SEARCH_FILTERS.length) % SEARCH_FILTERS.length]!);
  };
  const onEscape = (e: KeyboardEvent) => {
    if (voice && (voice.speech.speaking || voice.state === "listening" || voice.state === "starting")) return e.preventDefault();
    if (!query && chosen === "all") return;
    e.preventDefault();
    setQuery("");
    setChosen("all");
    setExpanded(new Set());
  };
  const expand = (id: GroupId) => setExpanded(new Set([...expanded, id]));
  return { query, parsed, chosen, expanded, changeQuery, changeFilter, tabFrom, onEscape, expand };
}

/** The hint right of the chips: how to leave a prefix, or how to look a task up by number. */
const hintOf = (prefix: "#" | "/" | null, searching: boolean) => (prefix ? `Backspace past ${prefix} shows all` : !searching ? "Type # for a task number" : undefined);

/** What the list shows for the query: the result with its filter and counts, and the sections with their rows. */
function searchList(input: {
  records: SearchRecords;
  tasks: SearchTasks | undefined;
  pages: SearchPage[];
  all: boolean;
  onlyProject: boolean;
  recent: SearchItem[];
  query: ReturnType<typeof useSearchQuery>;
  onOpenHit: SearchDialogProps["onOpenHit"];
  onRetryTasks: () => void;
  onAllProjects: () => void;
}) {
  const { records, tasks, pages, all, onlyProject, query } = input;
  const { parsed } = query;
  const result = searchResults({ records, tasks, pages, all, onlyProject }, query.query, { filter: query.chosen, expanded: query.expanded });
  const filter = result.filter;
  const ctx: RowContext = { projects: new Map(records.projects.map((p) => [p.id, p])), currentId: records.projectId, all };
  const searching = Boolean(parsed.prefix || parsed.term) || filter !== "all";
  const term = parsed.term || query.query.trim();
  const hitRow = (hit: SearchHit | SearchItem): Row => ({ key: hit.key, body: <HitRow hit={hit} ctx={ctx} />, run: (newTab) => input.onOpenHit(hit, newTab) });
  const list = searching
    ? resultSections({
        result,
        tasks,
        term,
        tasksShown: (filter === "all" || filter === "tasks") && parsed.prefix !== "/",
        all,
        ctx,
        hitRow,
        onExpand: query.expand,
        onRetryTasks: input.onRetryTasks,
        onAllProjects: input.onAllProjects,
      })
    : { sections: startSections({ records, pages, recent: input.recent, hitRow }), message: undefined, none: false };
  return { ...list, filter, counts: searching ? result.counts : undefined, term, hint: hintOf(parsed.prefix, searching) };
}

/** The row of the input: the search icon, the query, the project chip, and Cancel on a phone. */
function InputRow({ phone, query, onChange, onKeyDown, children }: { phone: boolean; query: string; onChange: (q: string) => void; onKeyDown: React.KeyboardEventHandler<HTMLInputElement>; children: ReactNode }) {
  return (
    <div className={cn("flex items-center gap-2.5 border-b pr-2.5 pl-4", phone ? "h-14 pr-1" : "h-[52px]")}>
      <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <CommandPrimitive.Input
        value={query}
        onValueChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={phone ? "Search" : "Search tasks, runs and pages"}
        className={cn("h-full min-w-0 flex-1 bg-transparent text-[15px] outline-hidden placeholder:text-muted-foreground", phone && "text-base")}
      />
      {children}
      {phone && (
        <DialogClose asChild>
          <Button variant="ghost" className="h-10 shrink-0 px-2.5 text-sm">
            Cancel
          </Button>
        </DialogClose>
      )}
    </div>
  );
}

/** The list: a message when only other projects match, the no results state, and the sections. */
function ResultList({ list, where, selected, phone }: { list: ReturnType<typeof searchList>; where: string; selected: string; phone: boolean }) {
  return (
    <CommandList className={cn("px-1.5 pt-1 pb-1.5", phone ? "max-h-none flex-1" : "max-h-[min(520px,calc(100dvh-14rem))]")}>
      {list.message && (
        <p className="flex items-center gap-2 px-2 pt-2.5 pb-1 text-[12.5px] text-muted-foreground">
          <SearchXIcon aria-hidden className="size-3.5" />
          {list.message}
        </p>
      )}
      {list.none && <NoResults term={list.term} where={where} />}
      {list.sections.map((section, i) => (
        <ResultSection key={section.id} section={section} first={i === 0} selected={selected} phone={phone} />
      ))}
    </CommandList>
  );
}

const DIALOG_CLASS = { phone: "inset-0 top-0 left-0 h-dvh max-h-dvh w-full max-w-none translate-x-0 rounded-none! ring-0", wide: "top-24 sm:max-w-[640px]" };

/**
 * Search over the dashboard: one input, filter chips, and the results in groups. Before a query it shows
 * Recent, the project's active runs and a few places to go. Tab and Shift+Tab change the filter, # and /
 * filter to tasks and pages, Esc clears the query and then closes, Enter opens and Cmd+Enter or
 * Ctrl+Enter opens in a new tab.
 */
export function SearchDialog(props: SearchDialogProps) {
  const { phone, all, onlyProject } = props;
  const records = props.records ?? NO_RECORDS;
  const [selected, setSelected] = useState("");
  const [recent] = useState(readRecent);
  const query = useSearchQuery();
  const pages = useMemo(() => searchPages(records.projects), [records.projects]);
  const list = searchList({ records, tasks: props.tasks, pages, all, onlyProject, recent, query, onOpenHit: props.onOpenHit, onRetryTasks: props.onRetryTasks, onAllProjects: props.onAllProjects });

  const rows = list.sections.flatMap((s) => s.rows);
  const value = rows.find((r) => r.key === selected)?.key ?? rows[0]?.key ?? "";
  const where = all ? "any project" : (records.projects.find((p) => p.current)?.name ?? "this project");
  const openInNewTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    rows.find((r) => r.key === value)?.run(true);
  };

  return (
    <CommandDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Search"
      description="Search tasks, runs, pages and chats"
      className={cn("gap-0 p-0", phone ? DIALOG_CLASS.phone : DIALOG_CLASS.wide)}
      contentProps={{ onEscapeKeyDown: query.onEscape, "data-phone": String(phone) } as React.ComponentProps<typeof CommandDialog>["contentProps"]}
    >
      <Command shouldFilter={false} loop vimBindings={false} value={value} onValueChange={setSelected} onKeyDown={openInNewTab} className={cn("rounded-none! p-0", phone && "h-full")}>
        <InputRow phone={phone} query={query.query} onChange={query.changeQuery} onKeyDown={query.tabFrom(list.filter)}>
          <ScopeChip projects={records.projects} all={all} pageProjectId={props.pageProjectId} onPickProject={props.onPickProject} onAllProjects={props.onAllProjects} />
        </InputRow>
        <FilterChips filter={list.filter} counts={list.counts} hint={phone ? undefined : list.hint} phone={phone} onChange={query.changeFilter} />
        <ResultList list={list} where={where} selected={value} phone={phone} />
        {!phone && <KeyHints clears={Boolean(query.query)} />}
      </Command>
    </CommandDialog>
  );
}


/** The project chip in the input: which project search covers, and its menu to pick another or All projects. */
function ScopeChip({
  projects,
  all,
  pageProjectId,
  onPickProject,
  onAllProjects,
}: {
  projects: SearchProject[];
  all: boolean;
  pageProjectId: string | undefined;
  onPickProject: (id: string) => void;
  onAllProjects: () => void;
}) {
  const current = projects.find((p) => p.current);
  const name = all ? "All projects" : (current?.name ?? "No project");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Searching ${all ? "all projects" : name}. Change`} className="shrink-0 gap-1.5 px-1.5 text-[12.5px]">
          {all ? <LayersIcon data-icon="inline-start" /> : <ProjectTile project={current ? { id: current.id, name: current.name } : null} />}
          {name}
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-62">
        <DropdownMenuLabel>Search in</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={all ? "all" : (current?.id ?? "")} onValueChange={(id) => (id === "all" ? onAllProjects() : onPickProject(id))}>
          {projects.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id} className="gap-2">
              <ProjectTile project={{ id: p.id, name: p.name }} className="size-[18px] text-[10px]" />
              {p.name}
              {p.id === pageProjectId && <span className="ml-auto text-xs text-muted-foreground">This project</span>}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value="all" className="gap-2">
            <ProjectTile project={null} className="size-[18px]" />
            All projects
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The filter chips, with each filter's count while searching or the # and / prefixes before, and a hint
 * on the right. The input keeps focus: a click on a chip or beside it changes the filter, and typing goes on.
 */
function FilterChips({
  filter,
  counts,
  hint,
  phone,
  onChange,
}: {
  filter: SearchFilter;
  counts: Record<SearchFilter, number> | undefined;
  hint: string | undefined;
  phone: boolean;
  onChange: (filter: SearchFilter) => void;
}) {
  return (
    <div role="tablist" aria-label="Show" onMouseDown={(e) => e.preventDefault()} className={cn("flex items-center gap-1 overflow-hidden border-b py-2", phone ? "px-2.5" : "px-3")}>
      {SEARCH_FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          role="tab"
          tabIndex={-1}
          aria-selected={filter === f}
          onClick={() => onChange(f)}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground",
            phone ? "h-[30px] text-[13px]" : "h-6",
            filter === f && "bg-muted text-foreground",
          )}
        >
          {FILTER_LABEL[f]}
          {counts ? (
            <span className="font-normal text-muted-foreground tabular-nums">{counts[f]}</span>
          ) : (
            FILTER_PREFIX[f] && <Kbd className="h-4 min-w-4 bg-transparent px-1 font-mono text-[10.5px] outline outline-border">{FILTER_PREFIX[f]}</Kbd>
          )}
        </button>
      ))}
      {hint && <span className="ml-auto text-[11.5px] whitespace-nowrap text-muted-foreground/80">{hint}</span>}
    </div>
  );
}

/** Nothing matches the query anywhere search looked. */
function NoResults({ term, where }: { term: string; where: string }) {
  return (
    <Empty className="gap-1.5 p-0 pt-7 pb-4">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon />
        </EmptyMedia>
        <EmptyTitle>No results for &quot;{term}&quot;</EmptyTitle>
        <EmptyDescription>Nothing in {where} matches: no task, run, page or chat.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** A group of rows under its heading and count; the selected row shows the Enter key. */
function ResultSection({ section, first, selected, phone }: { section: Section; first: boolean; selected: string; phone: boolean }) {
  return (
    <CommandGroup
      heading={
        section.heading && (
          <span className="flex items-center">
            {section.heading}
            {section.count && <span className="ml-auto font-normal text-muted-foreground/80 tabular-nums">{section.count}</span>}
          </span>
        )
      }
      className={cn(!first && "mt-1 border-t pt-0.5")}
    >
      {section.note}
      {section.loading && (
        <div role="status" aria-label="Loading tasks" className="flex flex-col gap-2 px-2 py-1.5">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-4/5" />
        </div>
      )}
      {section.rows.map((row) => (
        <CommandItem key={row.key} value={row.key} onSelect={() => row.run(false)} className={cn("min-h-[38px] gap-2.5 px-2 py-[5px] [&>svg:last-child]:hidden", phone && "min-h-12")}>
          {row.body}
          {/* The key is drawn, not written, so the row's text stays its result. */}
          {row.key === selected && !phone && <Kbd aria-hidden className="after:content-['↵']" />}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

/** The keys under the list; Esc reads Clear while there is a query. */
function KeyHints({ clears }: { clears: boolean }) {
  return (
    <div onMouseDown={(e) => e.preventDefault()} className="flex h-10 items-center gap-3.5 rounded-b-xl border-t bg-muted/50 px-3.5 text-[11.5px] whitespace-nowrap text-muted-foreground">
      <span className="flex items-center gap-1">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>Move
      </span>
      <span className="flex items-center gap-1">
        <Kbd>↵</Kbd>Open
      </span>
      <span className="flex items-center gap-1">
        <Kbd>Tab</Kbd>Next filter
      </span>
      <span className="flex items-center gap-1">
        <Kbd>Esc</Kbd>
        {clears ? "Clear" : "Close"}
      </span>
      <span className="ml-auto flex items-center gap-1">
        <Kbd>#</Kbd>Tasks<Kbd>/</Kbd>Pages
      </span>
    </div>
  );
}


/**
 * Why tasks have no status: GitHub did not answer, so they come from what the runs linked. Across all
 * projects it names the projects GitHub did not answer for; what GitHub said shows on hover.
 */
function TasksNote({ failed, all }: { failed: { name: string; error: string }[]; all: boolean }) {
  const text = all
    ? `GitHub did not answer for ${andList(failed.map((f) => f.name))}. ${failed.length === 1 ? "Its" : "Their"} tasks come from runs, without their status.`
    : "GitHub did not answer. These tasks come from runs, without their status.";
  return (
    <Alert title={failed.map((f) => f.error).join("\n")} className="mx-1 mt-0.5 mb-1.5 w-auto border-attention/30 bg-attention-bg py-2 text-xs">
      <CloudOffIcon className="text-attention" />
      <AlertDescription className="text-xs text-foreground">{text}</AlertDescription>
    </Alert>
  );
}
