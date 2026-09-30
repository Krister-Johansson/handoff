"use client";

import { useSyncExternalStore } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Field, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const CHOICES = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
] as const;

const subscribe = () => () => {};

/** Light, dark, or whatever the system uses. The choice is kept in this browser. */
export function ThemeSetting() {
  const { theme, setTheme } = useTheme();
  // The server cannot know the stored choice, so the selection shows once the page runs in the browser.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return (
    <RadioGroup value={mounted ? (theme ?? "system") : ""} onValueChange={setTheme} aria-label="Theme" className="flex flex-wrap gap-4">
      {CHOICES.map(({ value, label, icon: Icon }) => (
        <Field key={value} orientation="horizontal" className="w-auto">
          <RadioGroupItem value={value} id={`theme-${value}`} />
          <FieldLabel htmlFor={`theme-${value}`} className="font-normal">
            <Icon className="size-4" />
            {label}
          </FieldLabel>
        </Field>
      ))}
    </RadioGroup>
  );
}
