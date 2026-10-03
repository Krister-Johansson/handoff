import { useSyncExternalStore } from "react";

// The app is dark when <html> has the .dark class (Tailwind's class-based dark variant), which next-themes sets.
const isDark = () => document.documentElement.classList.contains("dark");
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
};

/** Whether the dashboard shows its dark theme now; light on the server. */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, isDark, () => false);
}
