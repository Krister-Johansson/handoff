import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeftIcon, TrashIcon } from "lucide-react";
import { deleteEntry } from "@/app/library/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Layout for a library entry's own page: back link, title, version and delete, then the form. */
export function EntryPage({
  tab,
  kind,
  title,
  subtitle,
  name,
  version,
  children,
}: {
  tab: "skills" | "mcp" | "agents";
  kind: "skill" | "mcp" | "agent";
  title: string;
  subtitle: string;
  name?: string;
  version?: number;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/library?tab=${tab}`}>
            <ArrowLeftIcon data-icon="inline-start" />
            Library
          </Link>
        </Button>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <span className={name ? "font-mono" : undefined}>{title}</span>
            {version !== undefined && <Badge variant="outline">v{version}</Badge>}
          </h1>
          <p className="text-muted-foreground">{subtitle}</p>
        </div>
        {name && (
          <form action={deleteEntry}>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="name" value={name} />
            <Button type="submit" variant="outline" size="sm" className="text-destructive">
              <TrashIcon data-icon="inline-start" />
              Delete
            </Button>
          </form>
        )}
      </div>
      {children}
    </main>
  );
}
