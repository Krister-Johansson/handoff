import Link from "next/link";
import { BellIcon, CpuIcon, FolderGit2Icon, MessageSquareIcon, AudioLinesIcon, SunMoonIcon, TerminalIcon, type LucideIcon } from "lucide-react";
import { SETTINGS_TAB_LABEL, type SettingsTab } from "@/lib/settings-tab";
import { cn } from "@/lib/utils";

const GROUPS: { label: string; items: { tab: SettingsTab; icon: LucideIcon }[] }[] = [
  { label: "Projects", items: [{ tab: "projects", icon: FolderGit2Icon }] },
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

/** The settings sections as a side navigation. Each link sets ?tab=, so a refresh or a shared link opens the same section. */
export function SettingsNav({ active }: { active: SettingsTab }) {
  return (
    <nav aria-label="Settings sections" className="flex gap-0.5 overflow-x-auto md:sticky md:top-[76px] md:flex-col md:overflow-visible">
      {GROUPS.map((group, i) => (
        <div key={group.label} className="flex shrink-0 gap-0.5 md:flex-col">
          <span className={cn("hidden px-2.5 pb-1 text-[11px] font-medium tracking-[0.05em] text-muted-foreground/70 uppercase md:block", i > 0 && "pt-3")}>{group.label}</span>
          {group.items.map(({ tab, icon: Icon }) => (
            <Link
              key={tab}
              href={`/settings?tab=${tab}`}
              aria-current={tab === active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-[7px] text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                tab === active && "bg-muted text-foreground",
              )}
            >
              <Icon aria-hidden className="size-[15px]" />
              {SETTINGS_TAB_LABEL[tab]}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
