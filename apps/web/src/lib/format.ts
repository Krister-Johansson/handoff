export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  if (ms < 1000) return `${(Math.round(ms / 100) / 10).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** The Claude CLI reports costs as client-side estimates at list price. */
export function formatCost(usd: number | string | null | undefined): string {
  if (usd === null || usd === undefined || usd === "") return "";
  const n = Number(usd);
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

/** How long ago a moment was, in the largest whole unit: "just now", "5 minutes ago", "3 days ago". */
export function formatAgo(when: Date, now: Date = new Date()): string {
  const s = Math.max(0, Math.floor((now.getTime() - when.getTime()) / 1000));
  if (s < 60) return "just now";
  const units: [string, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  const [unit, size] = units.find(([, size]) => s >= size)!;
  const n = Math.floor(s / size);
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}
