import Link from "next/link";
import { BellIcon, CpuIcon, MessageSquareIcon, MicIcon, SunMoonIcon, TerminalIcon, type LucideIcon } from "lucide-react";
import type { SettingsTab } from "@/lib/settings-tab";
import { cn } from "@/lib/utils";

const GROUPS: { label: string; items: { tab: SettingsTab; label: string; icon: LucideIcon }[] }[] = [
  {
    label: "Preferences",
    items: [
      { tab: "appearance", label: "Appearance", icon: SunMoonIcon },
      { tab: "notifications", label: "Notifications", icon: BellIcon },
      { tab: "voice", label: "Voice", icon: MicIcon },
    ],
  },
  {
    label: "Integrations",
    items: [
      { tab: "agents", label: "Claude Code", icon: TerminalIcon },
      { tab: "assistant", label: "Assistant", icon: MessageSquareIcon },
    ],
  },
  { label: "Worker", items: [{ tab: "worker", label: "Worker", icon: CpuIcon }] },
];

/** The settings sections as a side navigation. Each link sets ?tab=, so a refresh or a shared link opens the same section. */
export function SettingsNav({ active }: { active: SettingsTab }) {
  return (
    <nav aria-label="Settings sections" className="flex gap-0.5 overflow-x-auto md:sticky md:top-[76px] md:flex-col md:overflow-visible">
      {GROUPS.map((group, i) => (
        <div key={group.label} className="flex shrink-0 gap-0.5 md:flex-col">
          <span className={cn("hidden px-2.5 pb-1 text-[11px] font-medium tracking-[0.05em] text-muted-foreground/70 uppercase md:block", i > 0 && "pt-3")}>{group.label}</span>
          {group.items.map(({ tab, label, icon: Icon }) => (
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
              {label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
