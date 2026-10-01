import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONE = {
  outline: "border-border text-muted-foreground",
  attention: "border-transparent bg-attention-bg text-attention",
  danger: "border-transparent bg-danger-bg text-danger",
} as const;

/** A small label beside a name: a step's attempt, the edge that started it, a count of tool calls. */
export function Tag({ children, mono = false, tone = "outline", className }: { children: ReactNode; mono?: boolean; tone?: keyof typeof TONE; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-[5px] border px-[7px] text-[11px] font-medium whitespace-nowrap", mono && "font-mono", TONE[tone], className)}>
      {children}
    </span>
  );
}
