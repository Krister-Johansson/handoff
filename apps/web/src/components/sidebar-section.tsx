"use client";

import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { projectAt } from "@/lib/paths";
import type { ProjectSection } from "@/lib/project-tab";

/** A section a page told the sidebar, for the path it was told on. */
type Marked = { path: string; section: ProjectSection };

type SectionState = { marked: Marked | null; mark: (marked: Marked | null) => void; section: ProjectSection | undefined };

const SectionContext = createContext<SectionState | null>(null);

/** An issue page: its path alone cannot tell Plan from Issues. */
const ISSUE_PAGE = /^\/projects\/[^/]+\/issues\/[^/]+/;

/**
 * Keeps the project section the sidebar marks. The path decides, except on an issue page, which tells
 * its section itself (Plan for an item of the plan, Issues otherwise). Until it does, a direct visit
 * marks Issues, the section the route lives under, and a click from another page of the project keeps
 * that page's item.
 */
export function SidebarSectionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [marked, mark] = useState<Marked | null>(null);
  const [held, setHeld] = useState<{ projectId: string; section: ProjectSection | undefined }>();
  const at = projectAt(pathname);
  const told = marked?.path === pathname ? marked.section : undefined;
  const waiting = ISSUE_PAGE.test(pathname) && told === undefined;
  const section = told ?? (waiting && held && held.projectId === at?.projectId ? held.section : at?.section);
  // What the sidebar marks once a page knows its section is what it keeps while the next issue page loads.
  if (at && !waiting && (held?.projectId !== at.projectId || held.section !== section)) setHeld({ projectId: at.projectId, section });
  const value = useMemo(() => ({ marked, mark, section }), [marked, section]);
  return <SectionContext value={value}>{children}</SectionContext>;
}

/** Tells the sidebar which section the open page belongs to, for as long as the page is open. */
export function SidebarSection({ section }: { section: ProjectSection }) {
  const pathname = usePathname() ?? "/";
  const mark = use(SectionContext)?.mark;
  useEffect(() => {
    mark?.({ path: pathname, section });
    return () => mark?.(null);
  }, [mark, pathname, section]);
  return null;
}

/** The project section to mark for the path; without the provider (in tests of one part), the path's own. */
export function useProjectSection(pathname: string): ProjectSection | undefined {
  const state = use(SectionContext);
  return state ? state.section : projectAt(pathname)?.section;
}
