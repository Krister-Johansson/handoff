"use client";

import { useSyncExternalStore } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const CHOICES = [
  { value: "system", label: "System", icon: MonitorIcon, description: "Follows your system's light or dark setting." },
  { value: "light", label: "Light", icon: SunIcon, description: "A bright interface." },
  { value: "dark", label: "Dark", icon: MoonIcon, description: "Easier on the eyes in low light." },
] as const;

const subscribe = () => () => {};

/** Light, dark, or whatever the system uses, as a segmented switch. The choice is kept in this browser. */
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
    <div className="flex flex-col gap-2">
      <ToggleGroup
        type="single"
        value={current}
        onValueChange={(value) => value && setTheme(value)}
        aria-label="Theme"
        className="inline-flex w-fit gap-0.5 rounded-lg border bg-muted/50 p-0.5"
      >
        {CHOICES.map(({ value, label, icon: Icon }) => (
          <ToggleGroupItem
            key={value}
            value={value}
            aria-label={label}
            className="h-7 rounded-md px-2.5 text-xs text-muted-foreground data-[state=on]:bg-foreground data-[state=on]:text-background data-[state=on]:shadow-sm hover:data-[state=on]:bg-foreground hover:data-[state=on]:text-background"
          >
            <Icon />
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="min-h-4 text-xs text-muted-foreground">{chosen?.description}</p>
    </div>
  );
}
