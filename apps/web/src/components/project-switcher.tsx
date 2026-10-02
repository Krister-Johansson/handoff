"use client";

import Link from "next/link";
import { ChevronsUpDownIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { PROJECTS_SETTINGS_PATH, projectPath } from "@/lib/paths";
import type { ProjectSection } from "@/lib/project-tab";
import { cn } from "@/lib/utils";

/** A project as the sidebar shows it: in the switcher, and with its active runs beside Runs. */
export type SidebarProject = { id: string; name: string; repo: string; activeRuns: number };

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
 * The sidebar header: the open project, or the one used last, with a menu of the other projects, Add
 * project and Manage projects. Another project opens on the same page type, so the Plan of one project
 * switches to the Plan of the other.
 */
export function ProjectSwitcher({ projects, project, section }: { projects: SidebarProject[]; project: SidebarProject | undefined; section: ProjectSection | undefined }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const others = projects.filter((p) => p.id !== project?.id);
  const close = () => setOpenMobile(false);
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" aria-label={project ? `Project: ${project.name}. Switch project` : "No project yet. Add one"} className="data-[state=open]:bg-sidebar-accent">
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
            {others.length > 0 && (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Projects</DropdownMenuLabel>
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
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
