"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleDotIcon, GitForkIcon, GitPullRequestIcon, InboxIcon, LayoutDashboardIcon, LibraryIcon, ListTreeIcon, PlayIcon, SettingsIcon, SlidersHorizontalIcon } from "lucide-react";
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
import { ProjectSwitcher, type SidebarProject } from "@/components/project-switcher";
import { WorkerStatusView } from "@/components/worker-status-view";
import { lastProject, rememberProject } from "@/lib/last-project";
import { projectAt, projectPath } from "@/lib/paths";
import { workerLabel } from "@/lib/worker-status";
import type { ProjectSection } from "@/lib/project-tab";

export type { SidebarProject };

const PROJECT_ITEMS: { section: ProjectSection | undefined; label: string; icon: ComponentType }[] = [
  { section: undefined, label: "Overview", icon: LayoutDashboardIcon },
  { section: "runs", label: "Runs", icon: PlayIcon },
  { section: "plan", label: "Plan", icon: ListTreeIcon },
  { section: "issues", label: "Issues", icon: CircleDotIcon },
  { section: "pulls", label: "Pull requests", icon: GitPullRequestIcon },
  { section: "graphs", label: "Graphs", icon: GitForkIcon },
  { section: "settings", label: "Project settings", icon: SlidersHorizontalIcon },
];

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
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={current} tooltip={tooltip ?? label} className="font-medium text-muted-foreground data-active:text-sidebar-accent-foreground">
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
 * The dashboard's sidebar: the project switcher, the open project's pages, the pages across projects
 * (Inbox and Library), then Settings and the worker status. Collapsed it is a column of icons.
 */
export function AppSidebar({
  projects,
  lastProjectId,
  inboxCount,
  worker,
}: {
  projects: SidebarProject[];
  /** The project used last, from its cookie; shown outside a project. */
  lastProjectId?: string;
  inboxCount: number;
  worker: { live: number; queuedRuns: number };
}) {
  const pathname = usePathname() ?? "/";
  const at = projectAt(pathname);
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  // The layout read the cookie once; projects opened since then in this tab count as well.
  const [last, setLast] = useState(lastProjectId);
  if (at && at.projectId !== last) setLast(at.projectId);
  useEffect(() => {
    if (at?.projectId) rememberProject(at.projectId);
  }, [at?.projectId]);
  // In a project, that project; outside one, the one used last.
  const project = at ? projects.find((p) => p.id === at.projectId) : lastProject(projects, last);
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ProjectSwitcher projects={projects} project={project} section={at?.section} />
      </SidebarHeader>
      <SidebarContent>
        {project && (
          <SidebarGroup>
            <GroupLabel>Project</GroupLabel>
            <nav aria-label="Project">
              <SidebarMenu className="gap-0.5">
                {PROJECT_ITEMS.map((item) => (
                  <NavItem key={item.label} href={projectPath(project.id, item.section)} label={item.label} icon={item.icon} current={at?.projectId === project.id && at.section === item.section}>
                    {item.section === "runs" && project.activeRuns > 0 && <SidebarMenuBadge className="text-muted-foreground">{project.activeRuns}</SidebarMenuBadge>}
                  </NavItem>
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroup>
        )}
        <SidebarSeparator className="hidden group-data-[collapsible=icon]:block data-horizontal:w-auto" />
        <SidebarGroup>
          <GroupLabel>All projects</GroupLabel>
          <nav aria-label="All projects">
            <SidebarMenu className="gap-0.5">
              <NavItem
                href="/inbox"
                label="Inbox"
                icon={InboxIcon}
                current={inSection(pathname, "/inbox")}
                name={inboxCount > 0 ? `Inbox, ${inboxCount} waiting` : undefined}
                tooltip={inboxCount > 0 ? `Inbox, ${inboxCount} waiting` : undefined}
              >
                {inboxCount > 0 &&
                  (collapsed ? (
                    // The badge has no room on an icon, so a dot on its corner says something waits.
                    <span data-testid="inbox-dot" aria-hidden className="pointer-events-none absolute top-1 right-1 size-2 rounded-full bg-danger-dot ring-2 ring-sidebar" />
                  ) : (
                    <SidebarMenuBadge className="top-1.5! h-[18px] min-w-[18px] rounded-full bg-danger-dot px-1.5 text-[11px] font-semibold text-white!">{inboxCount}</SidebarMenuBadge>
                  ))}
              </NavItem>
              <NavItem href="/library" label="Library" icon={LibraryIcon} current={inSection(pathname, "/library")} />
            </SidebarMenu>
          </nav>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu className="gap-0.5">
          <NavItem href="/settings" label="Settings" icon={SettingsIcon} current={inSection(pathname, "/settings")} />
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={workerLabel(worker.live)}>
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
