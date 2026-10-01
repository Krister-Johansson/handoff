import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A small label for a version or a source: outlined, or filled with `fill`; `mono` for versions and paths. */
export function Tag({ children, fill, mono, className }: { children: ReactNode; fill?: boolean; mono?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-[5px] border px-[7px] text-[11px] font-medium whitespace-nowrap text-muted-foreground",
        fill && "border-transparent bg-secondary text-secondary-foreground",
        mono && "font-mono",
        className,
      )}
    >
      {children}
    </span>
  );
}
