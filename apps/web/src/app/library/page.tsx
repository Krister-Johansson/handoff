import Link from "next/link";
import { UrlTabs } from "@/components/url-tabs";
import { PageHeader } from "@/components/page-header";
import { PlusIcon, SearchIcon } from "lucide-react";
import { listLibraryIndex } from "@handoff/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { McpCheck } from "@handoff/engine/mcp-check";
import { CHECK_STATUS } from "@/lib/mcp-check-status";
import { StatusBadge } from "@/components/runs/status-badge";
import { getDb } from "@/lib/db";
import { groupSkillsBySource, type SkillSourceGroup } from "@/lib/skill-sources";

export const dynamic = "force-dynamic";

type Row = { name: string; detail: string; version: number; extra?: string | undefined; check?: McpCheck | null };

/** The last check of an MCP server, as a colored badge; "Not tested" before the first one. */
function CheckBadge({ check }: { check: McpCheck | null }) {
  if (!check) return <Badge variant="outline">Not tested</Badge>;
  const status = CHECK_STATUS[check.status];
  const label = check.status === "ok" ? `${status.label}, ${check.tools.length} tools` : status.label;
  return <StatusBadge status={status.tone} label={label} />;
}

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
          <TableHead className="w-60">Name</TableHead>
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
            <TableCell className="text-right whitespace-nowrap">
              {row.check !== undefined && <CheckBadge check={row.check} />} <Badge variant="outline">v{row.version}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const REGISTRY_LABEL = { "skills.sh": "skills.sh", github: "GitHub", local: "Written here" } as const;

/** Skills in one table per source: each skills.sh or GitHub repository, then the skills written here. */
function SkillsBySource({ groups }: { groups: SkillSourceGroup<SkillIndexRow>[] }) {
  if (groups.length === 0) return <EntryTable segment="skills" rows={[]} noun="skill" />;
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={`${group.registry}:${group.repo ?? ""}`} aria-label={group.repo ?? "Written here"} className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Badge variant={group.registry === "local" ? "outline" : "secondary"}>{REGISTRY_LABEL[group.registry]}</Badge>
            {group.repo && group.href && (
              <a href={group.href} className="font-mono hover:underline">
                {group.repo}
              </a>
            )}
            <span className="text-muted-foreground">{group.skills.length}</span>
            {group.registry === "skills.sh" && group.repo && (
              <Link href={`/library/skills-sh/${group.repo}`} className="ml-auto text-xs font-normal text-muted-foreground hover:underline">
                Choose skills
              </Link>
            )}
          </h3>
          <EntryTable segment="skills" rows={group.skills.map(skillRow)} noun="skill" />
        </section>
      ))}
    </div>
  );
}

type SkillIndexRow = Awaited<ReturnType<typeof listLibraryIndex>>["skills"][number];
const skillRow = (s: SkillIndexRow): Row => ({ name: s.name, detail: s.description, version: s.version, extra: s.fileCount ? `${s.fileCount + 1} files` : undefined });

const TABS = ["skills", "mcp", "agents", "groups"] as const;

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tab } = await searchParams;
  const active = TABS.find((t) => t === tab) ?? "skills";
  const { skills, mcp, agents, groups } = await listLibraryIndex(getDb());
  const sections = [
    {
      value: "skills",
      label: "Skills",
      noun: "skill",
      description: "SKILL.md instructions, with their supporting files, staged into a node's session with --add-dir.",
      rows: skills.map(skillRow),
      body: <SkillsBySource groups={groupSkillsBySource(skills)} />,
    },
    {
      value: "mcp",
      label: "MCP servers",
      noun: "MCP server",
      description: "Written to a per-execution mcp.json and loaded with --strict-mcp-config.",
      rows: mcp.map((s) => ({
        name: s.name,
        detail: s.transport === "stdio" ? `${s.command} ${s.args.join(" ")}` : (s.url ?? ""),
        version: s.version,
        check: (s.lastCheck as McpCheck | null) ?? null,
      })),
    },
    {
      value: "agents",
      label: "Agents",
      noun: "agent",
      description: "Subagent definitions passed with --agents, so a node's Claude session can delegate.",
      rows: agents.map((a) => ({ name: a.name, detail: a.description, version: a.version })),
    },
    {
      value: "groups",
      label: "Groups",
      noun: "group",
      description: "Named sets of skills, MCP servers and agents, like a skills repository or a plugin. A node that enables a group gets all of them.",
      rows: groups.map((g) => ({
        name: g.name,
        detail: g.description || [...g.skills, ...g.mcp, ...g.agents].join(", "),
        version: g.version,
        extra: `${g.skills.length + g.mcp.length + g.agents.length} entries`,
      })),
    },
  ];
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={[
          { label: "Library", href: "/library" },
          { label: sections.find((s) => s.value === active)?.label ?? "Skills", menu: sections.map((s) => ({ label: s.label, href: `/library?tab=${s.value}`, current: s.value === active })) },
        ]}
        title="Library"
        description="Skills, MCP servers, subagents and groups of them that graph nodes enable by name."
      />
      <UrlTabs value={active} className="gap-4">
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
                <CardAction className="flex gap-2">
                  {s.value === "skills" && (
                    <Button size="sm" variant="outline" asChild>
                      <Link href="/library/skills/browse">
                        <SearchIcon data-icon="inline-start" />
                        Add skills
                      </Link>
                    </Button>
                  )}
                  <Button size="sm" asChild>
                    <Link href={`/library/${s.value}/new`}>
                      <PlusIcon data-icon="inline-start" />
                      New {s.noun}
                    </Link>
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                {"body" in s && s.body ? s.body : <EntryTable segment={s.value} rows={s.rows} noun={s.noun} />}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </UrlTabs>
    </main>
  );
}
