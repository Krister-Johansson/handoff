import Link from "next/link";
import { cn } from "@/lib/utils";

export type FilterLink = { label: string; href: string; count?: number; current: boolean };

/** A row of links that narrow a list, the current one highlighted, each with an optional count. */
export function FilterLinks({ label, links }: { label: string; links: FilterLink[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-0.5">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={link.current ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            link.current && "bg-muted text-foreground",
          )}
        >
          {link.label}
          {link.count !== undefined && <span className="font-normal text-muted-foreground tabular-nums">{link.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
