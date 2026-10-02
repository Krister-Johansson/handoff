import type { DemoWarning } from "../schema/outputs.ts";

const MAX_WARNINGS = 50;
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const ERROR_LINE = /\b(?:error|exception|unhandled|uncaught|fatal)\b|\bERR_/i;
const WARNING_LINE = /\bwarn(?:ing)?\b|⚠/i;

/** The warnings and errors in an app's server log, one per distinct line, without terminal colours. */
export function serverLogWarnings(log: string): Omit<DemoWarning, "new">[] {
  const seen = new Set<string>();
  const found: Omit<DemoWarning, "new">[] = [];
  for (const raw of log.split("\n")) {
    const text = raw.replace(ANSI, "").trim();
    if (!text || seen.has(text)) continue;
    const level = ERROR_LINE.test(text) ? "error" : WARNING_LINE.test(text) ? "warning" : undefined;
    if (!level) continue;
    seen.add(text);
    found.push({ source: "server", level, text });
    if (found.length === MAX_WARNINGS) break;
  }
  return found;
}

/** A warning's identity across demos: its source and text, with numbers such as ports, times and ids left out. */
const identity = (w: Pick<DemoWarning, "source" | "text">) => `${w.source}:${w.text.replace(/[0-9a-f]{7,}|\d+/gi, "#")}`;

/** Marks each warning new unless the previous demo had it. Without a previous demo, every warning is new. */
export function markNew(current: Omit<DemoWarning, "new">[], previous: readonly Pick<DemoWarning, "source" | "text">[] | undefined): DemoWarning[] {
  const before = new Set((previous ?? []).map(identity));
  return current.map((w) => ({ ...w, new: !before.has(identity(w)) }));
}
