"use client";

import { CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseAnsi, type AnsiColor, type AnsiRun } from "@/lib/ansi";
import { cn } from "@/lib/utils";

// A dark block in both themes, so the usual terminal colours keep their contrast.
const FG: Record<AnsiColor, string> = {
  black: "text-zinc-500",
  red: "text-[oklch(0.78_0.16_25)]",
  green: "text-[oklch(0.8_0.15_160)]",
  yellow: "text-[oklch(0.85_0.14_85)]",
  blue: "text-[oklch(0.8_0.12_235)]",
  magenta: "text-fuchsia-400",
  cyan: "text-cyan-400",
  white: "text-zinc-100",
  brightBlack: "text-zinc-400",
  brightRed: "text-red-300",
  brightGreen: "text-emerald-300",
  brightYellow: "text-amber-200",
  brightBlue: "text-sky-300",
  brightMagenta: "text-fuchsia-300",
  brightCyan: "text-cyan-300",
  brightWhite: "text-white",
};

const BG: Record<AnsiColor, string> = {
  black: "bg-zinc-900",
  red: "bg-red-600",
  green: "bg-emerald-600",
  yellow: "bg-amber-500",
  blue: "bg-sky-600",
  magenta: "bg-fuchsia-600",
  cyan: "bg-cyan-500",
  white: "bg-zinc-200",
  brightBlack: "bg-zinc-700",
  brightRed: "bg-red-500",
  brightGreen: "bg-emerald-500",
  brightYellow: "bg-amber-400",
  brightBlue: "bg-sky-500",
  brightMagenta: "bg-fuchsia-500",
  brightCyan: "bg-cyan-400",
  brightWhite: "bg-white",
};

function Run({ run }: { run: AnsiRun }) {
  if (!run.fg && !run.bg && !run.bold && !run.dim) return <>{run.text}</>;
  return (
    <span data-fg={run.fg} className={cn(run.fg && FG[run.fg], run.bg && BG[run.bg], run.bold && "font-semibold", run.dim && "opacity-55")}>
      {run.text}
    </span>
  );
}

/** Items of fixed output paired with keys that stay the same across renders: the content, and a count for repeats. */
function keyed<T>(items: T[]): { key: string; runs: T }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const text = JSON.stringify(item);
    const n = (seen.get(text) ?? 0) + 1;
    seen.set(text, n);
    return { key: `${text}#${n}`, runs: item };
  });
}

/** Output of a command as a terminal shows it: its colours, in a dark scrollable block, with a copy button. */
export function TerminalOutput({ text, label = "output", className }: { text: string; label?: string; className?: string }) {
  const lines = parseAnsi(text.replace(/\s+$/, ""));
  const plain = lines.map((line) => line.map((r) => r.text).join("")).join("\n");
  return (
    <div className={cn("group relative overflow-hidden rounded-md border bg-terminal text-terminal-foreground", className)}>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label={`Copy ${label}`}
        className="absolute top-1.5 right-1.5 text-terminal-foreground/60 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-white/10 hover:text-terminal-foreground"
        onClick={() => void navigator.clipboard?.writeText(plain)}
      >
        <CopyIcon />
      </Button>
      <pre className="max-h-[260px] overflow-auto px-3 py-2.5 font-mono text-xs leading-[1.55] whitespace-pre-wrap break-words">
        {keyed(lines).map(({ key, runs }) => (
          <div key={key} className="min-h-[1.55em]">
            {keyed(runs).map(({ key: runKey, runs: run }) => (
              <Run key={runKey} run={run} />
            ))}
          </div>
        ))}
      </pre>
    </div>
  );
}
