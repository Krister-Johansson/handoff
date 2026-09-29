import { TrashIcon } from "lucide-react";
import { listLibrary } from "@handoff/db";
import { AgentForm, McpServerForm, SkillForm } from "@/components/library/forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDb } from "@/lib/db";
import { deleteEntry } from "./actions";

export const dynamic = "force-dynamic";

function DeleteButton({ kind, name }: { kind: "skill" | "mcp" | "agent"; name: string }) {
  return (
    <form action={deleteEntry}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="name" value={name} />
      <Button type="submit" variant="ghost" size="icon-sm" aria-label={`Delete ${name}`}>
        <TrashIcon />
      </Button>
    </form>
  );
}

function EntryTable({ kind, rows }: { kind: "skill" | "mcp" | "agent"; rows: { name: string; detail: string; version: number }[] }) {
  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nothing here yet</EmptyTitle>
          <EmptyDescription>Add one with the form. Nodes enable entries by name in their library settings.</EmptyDescription>
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
          <TableHead>Version</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name}>
            <TableCell className="font-mono text-xs">{row.name}</TableCell>
            <TableCell className="w-full max-w-0 truncate text-muted-foreground">{row.detail}</TableCell>
            <TableCell>
              <Badge variant="outline">v{row.version}</Badge>
            </TableCell>
            <TableCell>
              <DeleteButton kind={kind} name={row.name} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function LibraryPage() {
  const { skills, mcp, agents } = await listLibrary(getDb());
  const sections = [
    {
      value: "skills",
      label: "Skills",
      title: "Skills",
      description: "SKILL.md instructions staged into a node's session with --add-dir.",
      kind: "skill" as const,
      rows: skills.map((s) => ({ name: s.name, detail: s.description, version: s.version })),
      form: <SkillForm />,
    },
    {
      value: "mcp",
      label: "MCP servers",
      title: "MCP servers",
      description: "Written to a per-execution mcp.json and loaded with --strict-mcp-config.",
      kind: "mcp" as const,
      rows: mcp.map((s) => ({ name: s.name, detail: s.transport === "stdio" ? `${s.command} ${s.args.join(" ")}` : (s.url ?? ""), version: s.version })),
      form: <McpServerForm />,
    },
    {
      value: "agents",
      label: "Agents",
      title: "Subagents",
      description: "Definitions passed with --agents, so a node's Claude session can delegate.",
      kind: "agent" as const,
      rows: agents.map((a) => ({ name: a.name, detail: a.description, version: a.version })),
      form: <AgentForm />,
    },
  ];
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
        <p className="text-muted-foreground">Skills, MCP servers and subagents that graph nodes enable by name.</p>
      </div>
      <Tabs defaultValue="skills">
        <TabsList>
          {sections.map((s) => (
            <TabsTrigger key={s.value} value={s.value}>
              {s.label}
              <Badge variant="secondary">{s.rows.length}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>
        {sections.map((s) => (
          <TabsContent key={s.value} value={s.value} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
            <Card>
              <CardHeader>
                <CardTitle>{s.title}</CardTitle>
                <CardDescription>{s.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <EntryTable kind={s.kind} rows={s.rows} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Add or update</CardTitle>
                <CardDescription>Saving an existing name creates a new version.</CardDescription>
              </CardHeader>
              <CardContent>{s.form}</CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </main>
  );
}
