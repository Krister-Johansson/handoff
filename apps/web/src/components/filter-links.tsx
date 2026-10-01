import Link from "next/link";

export type FilterLink = { label: string; href: string; count?: number; current: boolean };

/** A row of links that narrow a list, kept in the query string, the current one lit, each with an optional count. */
export function FilterLinks({ label, links }: { label: string; links: FilterLink[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-0.5">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          scroll={false}
          aria-current={link.current ? "page" : undefined}
          className="inline-flex items-center gap-1.5 rounded-md px-[9px] py-[5px] text-[13px] font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
        >
          {link.label}
          {link.count !== undefined && " "}
          {link.count !== undefined && <span className="font-normal text-muted-foreground tabular-nums">{link.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
