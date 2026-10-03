"use client";

import Link from "next/link";
import { ChevronsUpDownIcon, PlusIcon, SettingsIcon, SlidersHorizontalIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PROJECTS_SETTINGS_PATH, projectPath } from "@/lib/paths";
import type { PlanModeName, ProjectSection } from "@/lib/project-tab";
import { cn } from "@/lib/utils";

/**
 * A project as the sidebar shows it: in the switcher, with its plan mode (which view Plan lists first),
 * and with its active runs (queued, running and waiting) and waiting runs under Runs.
 */
export type SidebarProject = { id: string; name: string; repo: string; planMode: PlanModeName; activeRuns: number; waitingRuns: number };

/** The project's first letter on the primary colour, so the collapsed switcher still names the project. */
export function ProjectTile({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground", className)}>
      {name.charAt(0)}
    </span>
  );
}

/** Name over repository, each cut to fit. */
function NameAndRepo({ name, repo, small }: { name: string; repo: string; small?: boolean }) {
  return (
    <span className="grid min-w-0 flex-1 text-left leading-tight">
      <span className={cn("truncate", small ? "font-medium" : "font-semibold")}>{name}</span>
      <span className={cn("truncate text-muted-foreground", small ? "font-mono text-[11px]" : "text-xs")}>{repo}</span>
    </span>
  );
}

/**
 * The sidebar header: the open project, or the one used last, with a menu of its Project settings, the
 * other projects, Add project and Manage projects. Another project opens on the same page type, so the
 * Plan of one project switches to the Plan of the other. Beside the switcher a sliders button opens
 * Project settings in one click; it is lit there and in the graph editor, and hides collapsed to icons.
 */
export function ProjectSwitcher({
  projects,
  project,
  section,
  settingsCurrent,
}: {
  projects: SidebarProject[];
  project: SidebarProject | undefined;
  section: ProjectSection | undefined;
  /** Whether the open page is the project's settings or a page under them, such as the graph editor. */
  settingsCurrent: boolean;
}) {
  const { isMobile, setOpenMobile, state } = useSidebar();
  const others = projects.filter((p) => p.id !== project?.id);
  const close = () => setOpenMobile(false);
  const settingsHref = project ? projectPath(project.id, "settings") : undefined;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label={project ? `Project: ${project.name}. Switch project` : "No project yet. Add one"}
              className={cn("data-[state=open]:bg-sidebar-accent", isMobile ? "group-has-data-[sidebar=menu-action]/menu-item:pr-12" : "group-has-data-[sidebar=menu-action]/menu-item:pr-10")}
            >
              {project ? (
                <>
                  <ProjectTile name={project.name} />
                  <NameAndRepo name={project.name} repo={project.repo} />
                </>
              ) : (
                <>
                  <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg border border-dashed text-muted-foreground">
                    <PlusIcon />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium text-muted-foreground">No project yet</span>
                </>
              )}
              <ChevronsUpDownIcon className="ml-auto text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="start" sideOffset={4} className="w-64">
            {project && settingsHref && (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="truncate font-semibold">{project.name}</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href={settingsHref} onClick={close}>
                      <span aria-hidden className="grid size-6 place-items-center text-muted-foreground">
                        <SlidersHorizontalIcon />
                      </span>
                      Project settings
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            {others.length > 0 && (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Switch project</DropdownMenuLabel>
                  {others.map((p) => (
                    <DropdownMenuItem key={p.id} asChild>
                      <Link href={projectPath(p.id, section)} onClick={close}>
                        <ProjectTile name={p.name} className="size-6 rounded-md text-xs" />
                        <NameAndRepo name={p.name} repo={p.repo} small />
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link href={`${PROJECTS_SETTINGS_PATH}&add=1`} onClick={close}>
                  <span aria-hidden className="grid size-6 place-items-center rounded-md border text-muted-foreground">
                    <PlusIcon />
                  </span>
                  Add project
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={PROJECTS_SETTINGS_PATH} onClick={close}>
                  <span aria-hidden className="grid size-6 place-items-center text-muted-foreground">
                    <SettingsIcon />
                  </span>
                  Manage projects
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {settingsHref && (state === "expanded" || isMobile) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <SidebarMenuAction
                asChild
                className={cn(
                  "right-1 rounded-md text-muted-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground",
                  isMobile ? "size-10 peer-data-[size=lg]/menu-button:top-1" : "size-8 peer-data-[size=lg]/menu-button:top-2",
                )}
              >
                <Link href={settingsHref} aria-label="Project settings" aria-current={settingsCurrent ? "page" : undefined} onClick={close}>
                  <SlidersHorizontalIcon />
                </Link>
              </SidebarMenuAction>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end">
              Project settings
            </TooltipContent>
          </Tooltip>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
