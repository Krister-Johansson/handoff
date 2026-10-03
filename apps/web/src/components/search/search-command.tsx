"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { searchRecordsAction, searchTasksAction } from "@/app/search/actions";
import { useOptionalAssistantPanel } from "@/components/assistant/assistant-provider";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useIsMobile } from "@/hooks/use-mobile";
import { issuePath, projectAt, runPath } from "@/lib/paths";
import { modKeyLabel, useIsMac } from "@/lib/platform";
import { rememberRecent } from "@/lib/search/recent";
import type { SearchHit, SearchItem } from "@/lib/search/results";
import { isSearchShortcut } from "@/lib/search/shortcut";
import type { SearchRecords, SearchTasks } from "@/lib/search/types";
import { SearchDialog } from "./search-dialog";

/** What search covers: a project (the open page's, or the one used last when none), or every project. */
type Scope = { projectId: string | undefined; all: boolean };

const NO_TASKS: SearchTasks = { tasks: [], sources: [] };

/** Where a result opens: a task's issue page, a run's page, a page's route. A chat opens in the assistant panel instead. */
function hrefOf(hit: SearchHit | SearchItem): string | undefined {
  switch (hit.kind) {
    case "task":
      return issuePath(hit.task.projectId, hit.task.number);
    case "run":
      return runPath(hit.run.projectId, hit.run.id);
    case "page":
      return hit.page.href;
    case "chat":
      return undefined;
  }
}

/**
 * Search in the top bar: the Search button with its shortcut (⌘K on a Mac, Ctrl K elsewhere; an icon on a
 * phone), Cmd+K and Ctrl+K from anywhere, and the dialog. Opening reads the data once: runs, chats and
 * projects at once, then the tasks, which GitHub answers through a cache. Typing reads nothing.
 */
export function SearchCommand() {
  const router = useRouter();
  const pathname = usePathname();
  const panel = useOptionalAssistantPanel();
  const mac = useIsMac();
  const phone = useIsMobile();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [scope, setScope] = useState<Scope>({ projectId: undefined, all: false });
  const [records, setRecords] = useState<SearchRecords>();
  const [tasks, setTasks] = useState<SearchTasks>();
  const reads = useRef({ records: 0, tasks: 0 });
  const pageProjectId = projectAt(pathname)?.projectId;

  const readTasks = (next: Scope) => {
    const id = ++reads.current.tasks;
    setTasks(undefined);
    const input = { ...(next.projectId ? { projectId: next.projectId } : {}), ...(next.all ? { all: true } : {}) };
    searchTasksAction(input).then(
      (found) => id === reads.current.tasks && setTasks(found),
      () => id === reads.current.tasks && setTasks(NO_TASKS),
    );
  };
  const read = (next: Scope) => {
    setScope(next);
    const id = ++reads.current.records;
    searchRecordsAction(next.projectId ? { projectId: next.projectId } : {}).then(
      (found) => id === reads.current.records && setRecords(found),
      () => undefined,
    );
    readTasks(next);
  };

  const show = () => {
    setSession((s) => s + 1);
    setOpen(true);
    read({ projectId: pageProjectId, all: false });
  };
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (!isSearchShortcut(e, mac)) return;
    // The browser's own Ctrl+K (address bar search) gives way while the dashboard has focus.
    e.preventDefault();
    if (open) setOpen(false);
    else show();
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const openHit = (hit: SearchHit | SearchItem, newTab: boolean) => {
    rememberRecent(hit);
    setOpen(false);
    const href = hrefOf(hit);
    if (!href) {
      if (hit.kind === "chat") void panel?.showChat(hit.chat.id);
      return;
    }
    if (newTab) window.open(href, "_blank", "noopener");
    else router.push(href);
  };
  // Search all projects keeps the project the results were for.
  const projectId = scope.projectId ?? records?.projectId ?? undefined;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label="Search"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={show}
        className="mr-1.5 font-normal text-muted-foreground max-md:size-8 max-md:border-0 max-md:bg-transparent max-md:shadow-none max-md:dark:bg-transparent md:w-[232px] md:justify-start md:pr-1.5"
      >
        <SearchIcon data-icon="inline-start" />
        <span className="flex-1 text-left max-md:hidden">Search</span>
        <KbdGroup className="max-md:hidden">
          <Kbd>{modKeyLabel(mac)}</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </Button>
      <SearchDialog
        key={session}
        open={open}
        onOpenChange={setOpen}
        phone={phone}
        records={records}
        tasks={tasks}
        all={scope.all}
        pageProjectId={pageProjectId}
        onPickProject={(id) => read({ projectId: id, all: false })}
        onAllProjects={() => {
          const next = { projectId, all: true };
          setScope(next);
          readTasks(next);
        }}
        onRetryTasks={() => readTasks({ ...scope, projectId })}
        onOpenHit={openHit}
      />
    </>
  );
}
