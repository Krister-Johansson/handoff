"use client";

import { useSyncExternalStore } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

// The previews use the design's fixed light and dark surfaces, whatever theme the page shows now.
const LIGHT = { page: "oklch(0.985 0.002 260)", bar: "oklch(0.88 0.004 260)" };
const DARK = { page: "oklch(0.15 0.004 260)", bar: "oklch(0.3 0.004 260)" };
const split = (a: string, b: string) => `linear-gradient(100deg, ${a} 50%, ${b} 50%)`;

const CHOICES = [
  { value: "system", label: "System", icon: MonitorIcon, description: "Follows your system's light or dark setting.", page: split(LIGHT.page, DARK.page), bar: split(LIGHT.bar, DARK.bar) },
  { value: "light", label: "Light", icon: SunIcon, description: "A bright interface.", page: LIGHT.page, bar: LIGHT.bar },
  { value: "dark", label: "Dark", icon: MoonIcon, description: "Easier on the eyes in low light.", page: DARK.page, bar: DARK.bar },
] as const;

const subscribe = () => () => {};

/** A small picture of the dashboard in a theme: a page with three lines of text. */
function Preview({ page, bar }: { page: string; bar: string }) {
  return (
    <span aria-hidden className="relative block h-[76px] overflow-hidden rounded-md border" style={{ background: page }}>
      {["top-3 right-2.5", "top-[26px] right-10", "top-10 right-[70px]"].map((at) => (
        <i key={at} className={cn("absolute left-2.5 h-1.5 rounded-[3px]", at)} style={{ background: bar }} />
      ))}
    </span>
  );
}

/** Light, dark, or whatever the system uses, as three cards with a preview. The choice is kept in this browser. */
export function ThemeSetting() {
  const { theme, setTheme } = useTheme();
  // The server cannot know the stored choice, so the selection shows once the page runs in the browser.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const current = mounted ? (theme ?? "system") : "";
  const chosen = CHOICES.find((c) => c.value === current);
  return (
    <div className="flex flex-col gap-3">
      <RadioGroup value={current} onValueChange={setTheme} aria-label="Theme" className="grid max-w-[520px] grid-cols-3 gap-2.5">
        {CHOICES.map(({ value, label, icon: Icon, page, bar }) => (
          <label
            key={value}
            className={cn("flex cursor-pointer flex-col gap-2 rounded-lg border p-2 transition-colors hover:bg-muted/50 has-focus-visible:ring-3 has-focus-visible:ring-ring/50", current === value && "border-foreground")}
          >
            <Preview page={page} bar={bar} />
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <Icon aria-hidden className="size-4" />
              {label}
              <RadioGroupItem value={value} aria-label={label} className="ml-auto" />
            </span>
          </label>
        ))}
      </RadioGroup>
      <p className="min-h-4 text-xs text-muted-foreground">{chosen?.description}</p>
    </div>
  );
}
