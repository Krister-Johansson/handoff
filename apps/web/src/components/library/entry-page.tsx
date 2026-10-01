import type { ReactNode } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { entryHeader, type EntryHeaderInput, type Kind } from "@/lib/library-entry-header";
import { libraryIndex } from "@/lib/library-index";
import { DeleteEntryButton } from "./delete-entry-button";
import { Tag } from "@/components/tag";

export function EntryMain({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">{children}</main>;
}

/** A card in the design's style: a small bold title, a muted line on what it is, then its content. */
export function EntryCard({ title, description, children, className }: { title?: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={className ?? "gap-0 py-0"}>
      {title && (
        <CardHeader className="px-5 pt-4 pb-0">
          <CardTitle className="text-sm font-semibold">
            <h2>{title}</h2>
          </CardTitle>
          {description && <CardDescription className="text-[13px]">{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className="px-5 py-4">{children}</CardContent>
    </Card>
  );
}

/** The groups that include this entry; a node that enables one of them gets the entry. */
export async function UsedByGroups({ kind, name }: { kind: "skills" | "mcp" | "agents"; name: string }) {
  const groups = (await libraryIndex()).groups.filter((g) => g[kind].includes(name));
  return (
    <EntryCard title="Used by" description="Groups that include this entry. Nodes that enable a group stage the latest version when a run starts.">
      {groups.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No group includes it. Nodes can still enable it by name.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {groups.map((g) => (
            <li key={g.name} className="flex items-center gap-2">
              <Tag>group</Tag>
              <Link href={`/library/groups/${encodeURIComponent(g.name)}`} className="font-mono text-xs hover:underline hover:underline-offset-3">
                {g.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </EntryCard>
  );
}

/** Layout for a library page other than the skill editor: the header with delete on an entry's own page, then the content. */
export async function EntryPage({ kind, children, ...input }: EntryHeaderInput & { kind: Kind; children: ReactNode }) {
  const header = await entryHeader(input);
  return (
    <EntryMain>
      <PageHeader {...header} actions={input.name && <DeleteEntryButton kind={kind} name={input.name} />} />
      {children}
    </EntryMain>
  );
}
