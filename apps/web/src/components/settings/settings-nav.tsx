"use client";

import { useCallback, useId } from "react";
import Link from "next/link";
import {
  AudioLinesIcon,
  BellIcon,
  BookOpenIcon,
  BotIcon,
  BoxesIcon,
  CalendarClockIcon,
  CpuIcon,
  FolderGit2Icon,
  GitForkIcon,
  LibraryIcon,
  MessageSquareIcon,
  PlugIcon,
  SunMoonIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";
import { PROJECT_SETTINGS_TAB_LABEL, projectSettingsPath, settingsPath, SETTINGS_TAB_LABEL, type ProjectSettingsTab, type SettingsTab } from "@/lib/settings-tab";
import { cn } from "@/lib/utils";

type MenuItem = { href: string; label: string; icon: LucideIcon; current: boolean };
type MenuGroup = { label: string; items: MenuItem[] };

/** One group of the side menu: its label over its links, and the label names the group for a screen reader. */
function Group({ group, first }: { group: MenuGroup; first: boolean }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex shrink-0 gap-0.5 md:flex-col">
      <span id={id} className={cn("hidden px-2.5 pb-1 text-[11px] font-medium tracking-[0.05em] text-muted-foreground/70 uppercase md:block", !first && "pt-3")}>
        {group.label}
      </span>
      {group.items.map(({ href, label, icon: Icon, current }) => (
        <Link
          key={href}
          href={href}
          aria-current={current ? "page" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-md px-2.5 py-[7px] text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            current && "bg-muted text-foreground",
          )}
        >
          <Icon aria-hidden className="size-[15px]" />
          {label}
        </Link>
      ))}
    </div>
  );
}

/**
 * The sections of a settings page as a side menu of groups. Under 768 px it is one row of links that
 * scrolls sideways, scrolled so the open section's link is in view.
 */
function SideMenu({ label, groups }: { label: string; groups: MenuGroup[] }) {
  const currentHref = groups.flatMap((g) => g.items).find((i) => i.current)?.href;
  // A new open section gives a new callback, so React runs it again after the link changes.
  const showCurrent = useCallback(
    (nav: HTMLElement | null) => {
      if (!nav || !currentHref || nav.scrollWidth <= nav.clientWidth) return;
      const link = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!link) return;
      const start = link.offsetLeft;
      const end = start + link.offsetWidth;
      if (start < nav.scrollLeft || end > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = start - 16;
    },
    [currentHref],
  );
  return (
    <nav ref={showCurrent} aria-label={label} className="relative flex gap-0.5 overflow-x-auto [scrollbar-width:none] md:sticky md:top-[76px] md:flex-col md:overflow-visible">
      {groups.map((group, i) => (
        <Group key={group.label} group={group} first={i === 0} />
      ))}
    </nav>
  );
}

const SETTINGS_GROUPS: { label: string; items: { tab: SettingsTab; icon: LucideIcon }[] }[] = [
  { label: "Projects", items: [{ tab: "projects", icon: FolderGit2Icon }] },
  {
    label: "Library",
    items: [
      { tab: "skills", icon: BookOpenIcon },
      { tab: "subagents", icon: BotIcon },
      { tab: "mcp", icon: PlugIcon },
      { tab: "groups", icon: BoxesIcon },
    ],
  },
  {
    label: "Preferences",
    items: [
      { tab: "appearance", icon: SunMoonIcon },
      { tab: "notifications", icon: BellIcon },
      { tab: "voice", icon: AudioLinesIcon },
    ],
  },
  {
    label: "Integrations",
    items: [
      { tab: "agents", icon: TerminalIcon },
      { tab: "assistant", icon: MessageSquareIcon },
    ],
  },
  { label: "Worker", items: [{ tab: "worker", icon: CpuIcon }] },
];

/** The sections of Settings as a side menu. Each link sets ?tab=, so a refresh or a shared link opens the same section. */
export function SettingsNav({ active }: { active: SettingsTab }) {
  const groups = SETTINGS_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.map(({ tab, icon }) => ({ href: settingsPath(tab), label: SETTINGS_TAB_LABEL[tab], icon, current: tab === active })),
  }));
  return <SideMenu label="Settings sections" groups={groups} />;
}

/**
 * The sections of a project's settings. Runs: what a run starts from. Plan: how the project's plan is
 * worked. Plan mode (issue 490) goes first in the Plan group, before the Scheduler.
 */
const PROJECT_SETTINGS_GROUPS: { label: string; items: { tab: ProjectSettingsTab; icon: LucideIcon }[] }[] = [
  {
    label: "Runs",
    items: [
      { tab: "graphs", icon: GitForkIcon },
      { tab: "library", icon: LibraryIcon },
    ],
  },
  { label: "Plan", items: [{ tab: "scheduler", icon: CalendarClockIcon }] },
];

/** The sections of a project's settings as a side menu, each link setting ?tab= as Settings does. */
export function ProjectSettingsNav({ projectId, active }: { projectId: string; active: ProjectSettingsTab }) {
  const groups = PROJECT_SETTINGS_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.map(({ tab, icon }) => ({ href: projectSettingsPath(projectId, tab), label: PROJECT_SETTINGS_TAB_LABEL[tab], icon, current: tab === active })),
  }));
  return <SideMenu label="Project settings sections" groups={groups} />;
}
