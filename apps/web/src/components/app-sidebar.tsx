"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CircleDotIcon, GitPullRequestIcon, HouseIcon, InboxIcon, ListTreeIcon, PlayIcon, SettingsIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { ChatsGroup } from "@/components/assistant/chats-group";
import { ProjectSwitcher, type SidebarProject } from "@/components/project-switcher";
import { useProjectSection } from "@/components/sidebar-section";
import { PHONE_ROW, ROW, SidebarSubmenu, type SectionPlace, type SubItem } from "@/components/sidebar-submenu";
import { WorkerStatusView } from "@/components/worker-status-view";
import { useInboxCount } from "@/hooks/use-inbox-count";
import { lastProject, rememberProject } from "@/lib/last-project";
import { planPath, projectAt, projectPath, runsPath } from "@/lib/paths";
import { parsePlanView, type PlanViewName, type ProjectSection } from "@/lib/project-tab";
import { parseRunsFilter, RUNS_FILTERS, type RunsFilter } from "@/lib/run-status-filter";
import { cn } from "@/lib/utils";
import { workerLabel } from "@/lib/worker-status";

export type { SidebarProject };

/** The sections with a submenu, and whether each is open. */
type Folds = { plan: boolean; runs: boolean };

const PLAN_VIEW_LABEL: Record<PlanViewName, string> = { flow: "Flow", timeline: "Timeline", board: "Board", tree: "Tree" };

/**
 * Where the open page sits in the project's Plan and Runs: the Plan view on screen (the plan mode's
 * unless ?view= asks for the tree or the board), the Runs filter from ?status=, or neither on another
 * page of the section, such as a run page or an issue page reached from the plan.
 */
function subPage(pathname: string, search: URLSearchParams, project: SidebarProject): { view?: PlanViewName; filter?: RunsFilter } {
  const params = Object.fromEntries(search);
  if (pathname === projectPath(project.id, "plan")) return { view: parsePlanView(params, project.planMode) };
  if (pathname === projectPath(project.id, "runs")) return { filter: parseRunsFilter(params) };
  return {};
}

const place = (inside: boolean, sub: boolean): SectionPlace => (!inside ? "outside" : sub ? "sub" : "parent");

const inSection = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The group label in the style of the Settings nav: small uppercase. */
function GroupLabel({ children }: { children: ReactNode }) {
  return <SidebarGroupLabel className="h-7 text-[11px] font-medium tracking-wider text-muted-foreground/80 uppercase">{children}</SidebarGroupLabel>;
}

/**
 * One page of the sidebar: icon and label, the accent fill and aria-current on the current page, and
 * the label as a tooltip while collapsed. Following it closes the sheet on a phone.
 */
function NavItem({
  href,
  label,
  icon: Icon,
  current,
  name,
  tooltip,
  children,
}: {
  href: string;
  label: string;
  icon: ComponentType;
  current: boolean;
  /** The accessible name when it says more than the label, such as a count. */
  name?: string;
  tooltip?: string;
  /** A badge or marker beside the button. */
  children?: ReactNode;
}) {
  const { setOpenMobile, isMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={current} tooltip={tooltip ?? label} className={cn(ROW, isMobile && PHONE_ROW)}>
        <Link href={href} aria-current={current ? "page" : undefined} aria-label={name} onClick={() => setOpenMobile(false)}>
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
      {children}
    </SidebarMenuItem>
  );
}

/**
 * The Inbox across projects with its red count, read again while the layout stays mounted; collapsed to
 * icons the count becomes a dot on the icon's corner.
 */
function InboxItem({ renderedCount, load, intervalMs, current }: { renderedCount: number; load?: () => Promise<number>; intervalMs?: number; current: boolean }) {
  const count = useInboxCount(renderedCount, { load, intervalMs });
  const { state, isMobile } = useSidebar();
  const name = count > 0 ? `Inbox, ${count} waiting` : undefined;
  return (
    <NavItem href="/inbox" label="Inbox" icon={InboxIcon} current={current} name={name} tooltip={name}>
      {count > 0 &&
        (state === "collapsed" && !isMobile ? (
          // The badge has no room on an icon, so a dot on its corner says something waits.
          <span data-testid="inbox-dot" aria-hidden className="pointer-events-none absolute top-1 right-1 size-2 rounded-full bg-danger-dot ring-2 ring-sidebar" />
        ) : (
          <SidebarMenuBadge className={cn("top-1.5! h-[18px] min-w-[18px] rounded-full bg-danger-dot px-1.5 text-[11px] font-semibold text-white!", isMobile && "top-[11px]!")}>
            {count}
          </SidebarMenuBadge>
        ))}
    </NavItem>
  );
}

/**
 * The project's Plan group (Plan with its views, Issues) and Build group (Runs with its filters, Pull
 * requests). On every navigation, and when an issue page tells its section, the submenu holding the open
 * page opens; the other keeps the state it was folded to by hand. No cookie keeps either.
 */
function ProjectGroups({
  project,
  here,
  pathname,
  search,
}: {
  project: SidebarProject;
  /** The section of the open page, when it is a page of this project. */
  here: ProjectSection | undefined;
  pathname: string;
  search: URLSearchParams | null;
}) {
  const { isMobile } = useSidebar();
  const navKey = `${pathname}?${search?.toString() ?? ""}#${here ?? ""}`;
  const [folds, setFolds] = useState<Folds>({ plan: here === "plan", runs: here === "runs" });
  const [seen, setSeen] = useState(navKey);
  if (seen !== navKey) {
    setSeen(navKey);
    if ((here === "plan" || here === "runs") && !folds[here]) setFolds({ ...folds, [here]: true });
  }
  const sub = subPage(pathname, search ?? new URLSearchParams(), project);
  const planItems: SubItem[] = ([project.planMode, "board", "tree"] as PlanViewName[]).map((view) => ({
    label: PLAN_VIEW_LABEL[view],
    href: planPath(project.id, { view }),
    current: here === "plan" && sub.view === view,
  }));
  const runCounts: Partial<Record<RunsFilter, number>> = { active: project.activeRuns - project.waitingRuns, waiting: project.waitingRuns };
  const runItems: SubItem[] = RUNS_FILTERS.map((f) => ({
    label: f.label,
    href: runsPath(project.id, f.value),
    current: here === "runs" && sub.filter === f.value,
    count: runCounts[f.value],
  }));
  const runsName = project.activeRuns > 0 ? `Runs, ${project.activeRuns} active` : undefined;
  return (
    <>
      <SidebarGroup>
        <GroupLabel>Plan</GroupLabel>
        <nav aria-label="Plan">
          <SidebarMenu className="gap-0.5">
            <SidebarSubmenu
              label="Plan"
              href={projectPath(project.id, "plan")}
              icon={ListTreeIcon}
              place={place(here === "plan", planItems.some((i) => i.current))}
              items={planItems}
              open={folds.plan}
              onOpenChange={(open) => setFolds({ ...folds, plan: open })}
              toggleLabel="Plan views"
            />
            <NavItem href={projectPath(project.id, "issues")} label="Issues" icon={CircleDotIcon} current={here === "issues"} />
          </SidebarMenu>
        </nav>
      </SidebarGroup>
      <SidebarGroup>
        <GroupLabel>Build</GroupLabel>
        <nav aria-label="Build">
          <SidebarMenu className="gap-0.5">
            <SidebarSubmenu
              label="Runs"
              href={projectPath(project.id, "runs")}
              icon={PlayIcon}
              place={place(here === "runs", runItems.some((i) => i.current))}
              items={runItems}
              all={{ label: "All runs", href: projectPath(project.id, "runs"), current: here === "runs" && sub.filter === undefined }}
              open={folds.runs}
              onOpenChange={(open) => setFolds({ ...folds, runs: open })}
              toggleLabel="Run filters"
              name={runsName}
              badge={
                project.activeRuns > 0 && (
                  <SidebarMenuBadge className={cn("right-8 text-muted-foreground", isMobile && "top-2.5!")}>{project.activeRuns}</SidebarMenuBadge>
                )
              }
            />
            <NavItem href={projectPath(project.id, "pulls")} label="Pull requests" icon={GitPullRequestIcon} current={here === "pulls"} />
          </SidebarMenu>
        </nav>
      </SidebarGroup>
    </>
  );
}

/**
 * The dashboard's sidebar: the project switcher with a Project settings button, Home and the Inbox
 * across projects, the project's Plan group (Plan with its views, Issues) and Build group (Runs with its
 * filters, Pull requests), the assistant's chats, then Settings and the worker status. A project's graphs
 * are in its Project settings and the library is in Settings, so the graph editor lights the Project
 * settings button and a library entry marks Settings. The submenu that holds the open page opens on
 * every navigation; a chevron folds either by hand until the next reload. Collapsed it is a column of
 * icons, and Plan and Runs open their items as a flyout.
 */
export function AppSidebar({
  projects,
  lastProjectId,
  inboxCount: renderedInboxCount,
  worker,
  loadInboxCount,
  inboxIntervalMs,
  chatsOpen = true,
}: {
  projects: SidebarProject[];
  /** The project used last, from its cookie; shown outside a project. */
  lastProjectId?: string;
  /** The Inbox count when the layout rendered; the badge reads it again while the layout stays. */
  inboxCount: number;
  worker: { live: number; queuedRuns: number };
  loadInboxCount?: () => Promise<number>;
  inboxIntervalMs?: number;
  /** Whether the Chats group is open, from its cookie. */
  chatsOpen?: boolean;
}) {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams();
  const at = projectAt(pathname);
  const section = useProjectSection(pathname);
  const { isMobile } = useSidebar();
  // The layout read the cookie once; projects opened since then in this tab count as well.
  const [last, setLast] = useState(lastProjectId);
  if (at && at.projectId !== last) setLast(at.projectId);
  useEffect(() => {
    if (at?.projectId) rememberProject(at.projectId);
  }, [at?.projectId]);
  // In a project, that project; outside one, the one used last.
  const project = at ? projects.find((p) => p.id === at.projectId) : lastProject(projects, last);
  // The section of the open page, when it is a page of the project the sidebar shows.
  const here = project && at?.projectId === project.id ? section : undefined;
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ProjectSwitcher projects={projects} project={project} section={section} settingsCurrent={here === "settings"} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="pb-0">
          <nav aria-label="Home and Inbox">
            <SidebarMenu className="gap-0.5">
              {project && <NavItem href={projectPath(project.id)} label="Home" icon={HouseIcon} current={at?.projectId === project.id && section === undefined} />}
              <InboxItem renderedCount={renderedInboxCount} load={loadInboxCount} intervalMs={inboxIntervalMs} current={inSection(pathname, "/inbox")} />
            </SidebarMenu>
          </nav>
        </SidebarGroup>
        <SidebarSeparator className="hidden group-data-[collapsible=icon]:block data-horizontal:w-auto" />
        {project && <ProjectGroups project={project} here={here} pathname={pathname} search={search} />}
        <ChatsGroup initialOpen={chatsOpen} pathname={pathname} />
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu className="gap-0.5">
          <NavItem href="/settings" label="Settings" icon={SettingsIcon} current={inSection(pathname, "/settings") || inSection(pathname, "/library")} />
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={workerLabel(worker.live)} className={cn(isMobile && PHONE_ROW)}>
              <Link href="/settings?tab=worker">
                <WorkerStatusView live={worker.live} queuedRuns={worker.queuedRuns} />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
