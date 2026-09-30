import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { listLibrary } from "@handoff/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = { name: string; detail: string; version: number; extra?: string | undefined };

function EntryTable({ segment, rows, noun }: { segment: string; rows: Row[]; noun: string }) {
  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No {noun}s yet</EmptyTitle>
          <EmptyDescription>Add one with New {noun}. Nodes enable library entries by name in their settings.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Details</TableHead>
          <TableHead className="text-right">Version</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name} className="relative">
            <TableCell className="font-mono text-xs">
              <Link href={`/library/${segment}/${row.name}`} className="after:absolute after:inset-0 hover:underline">
                {row.name}
              </Link>
            </TableCell>
            <TableCell className="w-full max-w-0 truncate text-muted-foreground">
              {row.detail}
              {row.extra && <span className="ml-2 text-xs">{row.extra}</span>}
            </TableCell>
            <TableCell className="text-right">
              <Badge variant="outline">v{row.version}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const TABS = ["skills", "mcp", "agents"] as const;

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tab } = await searchParams;
  const active = TABS.find((t) => t === tab) ?? "skills";
  const { skills, mcp, agents } = await listLibrary(getDb());
  const sections = [
    {
      value: "skills",
      label: "Skills",
      noun: "skill",
      description: "SKILL.md instructions, with their supporting files, staged into a node's session with --add-dir.",
      rows: skills.map((s) => ({ name: s.name, detail: s.description, version: s.version, extra: s.files.length ? `${s.files.length + 1} files` : undefined })),
    },
    {
      value: "mcp",
      label: "MCP servers",
      noun: "MCP server",
      description: "Written to a per-execution mcp.json and loaded with --strict-mcp-config.",
      rows: mcp.map((s) => ({ name: s.name, detail: s.transport === "stdio" ? `${s.command} ${s.args.join(" ")}` : (s.url ?? ""), version: s.version })),
    },
    {
      value: "agents",
      label: "Agents",
      noun: "agent",
      description: "Subagent definitions passed with --agents, so a node's Claude session can delegate.",
      rows: agents.map((a) => ({ name: a.name, detail: a.description, version: a.version })),
    },
  ];
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
        <p className="text-muted-foreground">Skills, MCP servers and subagents that graph nodes enable by name.</p>
      </div>
      <Tabs defaultValue={active} className="gap-4">
        <TabsList>
          {sections.map((s) => (
            <TabsTrigger key={s.value} value={s.value}>
              {s.label}
              <Badge variant="secondary">{s.rows.length}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>
        {sections.map((s) => (
          <TabsContent key={s.value} value={s.value}>
            <Card>
              <CardHeader>
                <CardTitle>{s.label}</CardTitle>
                <CardDescription>{s.description}</CardDescription>
                <CardAction>
                  <Button size="sm" asChild>
                    <Link href={`/library/${s.value}/new`}>
                      <PlusIcon data-icon="inline-start" />
                      New {s.noun}
                    </Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <EntryTable segment={s.value} rows={s.rows} noun={s.noun} />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </main>
  );
}
