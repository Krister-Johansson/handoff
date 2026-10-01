import type { ReactNode } from "react";
import Form from "next/form";
import Link from "next/link";
import { DownloadIcon, PlusIcon } from "lucide-react";
import { listLibraryIndex } from "@handoff/db";
import type { McpCheck } from "@handoff/engine/mcp-check";
import { GroupEntries } from "@/components/library/group-entries";
import { SearchField } from "@/components/library/search-field";
import { Tag } from "@/components/tag";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/runs/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/url-tabs";
import { getDb } from "@/lib/db";
import { matchesLibrarySearch } from "@/lib/library-search";
import { CHECK_STATUS } from "@/lib/mcp-check-status";
import { groupSkillsBySource, type SkillSourceGroup } from "@/lib/skill-sources";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Row = { name: string; detail: string; mono?: boolean; extra?: string | undefined; version: number; cell?: ReactNode };
/** A third column some tabs add between details and version: an MCP server's last check, a group's entries. */
type Extra = { label: string; width: string };

/** The last check of an MCP server, as a colored pill; "Not tested" before the first one. */
function CheckBadge({ check }: { check: McpCheck | null }) {
  if (!check) return <StatusBadge status="queued" label="Not tested" />;
  const status = CHECK_STATUS[check.status];
  const label = check.status === "ok" ? `${status.label}, ${check.tools.length} tools` : status.label;
  return <StatusBadge status={status.tone} label={label} />;
}

const head = "h-auto px-5 py-[9px] text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase";

/** Entries as a table whose rows open the entry. Tables of one tab share column widths, so they line up. */
function EntryTable({ segment, rows, extra, nameWidth = "w-[260px]", showHead = true }: { segment: string; rows: Row[]; extra?: Extra; nameWidth?: string; showHead?: boolean }) {
  return (
    <Table className="min-w-[640px] table-fixed text-[13px]">
      <colgroup>
        <col className={nameWidth} />
        <col />
        {extra && <col className={extra.width} />}
        <col className="w-20" />
      </colgroup>
      {showHead && (
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={head}>Name</TableHead>
            <TableHead className={head}>Details</TableHead>
            {extra && <TableHead className={head}>{extra.label}</TableHead>}
            <TableHead className={cn(head, "text-right")}>Version</TableHead>
          </TableRow>
        </TableHeader>
      )}
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name} className="relative">
            <TableCell className="truncate px-5 py-2.5 font-mono text-xs">
              <Link href={`/library/${segment}/${encodeURIComponent(row.name)}`} className="after:absolute after:inset-0 hover:underline hover:underline-offset-3">
                {row.name}
              </Link>
            </TableCell>
            <TableCell className={cn("truncate px-5 py-2.5 text-muted-foreground", row.mono && "font-mono text-xs")}>
              {row.detail}
              {row.extra && <span className="ml-1.5 text-xs">{row.extra}</span>}
            </TableCell>
            {extra && <TableCell className="px-5 py-2.5 whitespace-normal">{row.cell}</TableCell>}
            <TableCell className="px-5 py-2.5 text-right">
              <Tag mono>v{row.version}</Tag>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function NoEntries({ noun, query }: { noun: string; query: string }) {
  return (
    <Empty className="border-t">
      <EmptyHeader>
        {query ? (
          <>
            <EmptyTitle>No {noun}s match &quot;{query}&quot;</EmptyTitle>
            <EmptyDescription>Search by name or description, or clear the search.</EmptyDescription>
          </>
        ) : (
          <>
            <EmptyTitle>No {noun}s yet</EmptyTitle>
            <EmptyDescription>Add one with New {noun}. Nodes enable library entries by name in their settings.</EmptyDescription>
          </>
        )}
      </EmptyHeader>
    </Empty>
  );
}

const REGISTRY_LABEL = { "skills.sh": "skills.sh", github: "GitHub", local: "Written here" } as const;

/** Skills in one table per source: each skills.sh or GitHub repository, then the skills written here. */
function SkillsBySource({ groups }: { groups: SkillSourceGroup<SkillIndexRow>[] }) {
  return groups.map((group, i) => (
    <section key={`${group.registry}:${group.repo ?? ""}`} aria-label={group.repo ?? "Written here"} className={cn(i > 0 && "border-t")}>
      <h3 className="flex items-center gap-2 px-5 pt-3 pb-2 text-[13px] font-normal">
        <Tag tone={group.registry !== "local" ? "fill" : "outline"}>{REGISTRY_LABEL[group.registry]}</Tag>
        {group.repo && group.href && (
          <a href={group.href} className="font-mono text-xs hover:underline hover:underline-offset-3">
            {group.repo}
          </a>
        )}
        <span className="text-muted-foreground">{group.skills.length}</span>
        {group.registry === "skills.sh" && group.repo && (
          <Link href={`/library/skills-sh/${group.repo}`} className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline hover:underline-offset-3">
            Choose skills
          </Link>
        )}
      </h3>
      <EntryTable segment="skills" rows={group.skills.map(skillRow)} showHead={i === 0} />
    </section>
  ));
}

type SkillIndexRow = Awaited<ReturnType<typeof listLibraryIndex>>["skills"][number];
const skillRow = (s: SkillIndexRow): Row => ({ name: s.name, detail: s.description, version: s.version, extra: s.fileCount ? `${s.fileCount + 1} files` : undefined });

const TABS = ["skills", "agents", "mcp", "groups"] as const;

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const active = TABS.find((t) => t === params.tab) ?? "skills";
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const index = await listLibraryIndex(getDb());
  const skills = index.skills.filter((s) => matchesLibrarySearch([s.name, s.description], query));
  const mcp = index.mcp.filter((s) => matchesLibrarySearch([s.name, s.url ?? "", s.command ?? "", ...s.args], query));
  const agents = index.agents.filter((a) => matchesLibrarySearch([a.name, a.description], query));
  const groups = index.groups.filter((g) => matchesLibrarySearch([g.name, g.description, ...g.skills, ...g.mcp, ...g.agents], query));
  const sections = [
    {
      value: "skills",
      label: "Skills",
      noun: "skill",
      count: skills.length,
      description: "SKILL.md instructions, with their supporting files, staged into a node's session with --add-dir. One table per source.",
      body: <SkillsBySource groups={groupSkillsBySource(skills)} />,
    },
    {
      value: "agents",
      label: "Agents",
      noun: "agent",
      count: agents.length,
      description: "Subagent definitions passed with --agents, so a node's Claude session can delegate.",
      body: <EntryTable segment="agents" rows={agents.map((a) => ({ name: a.name, detail: a.description, version: a.version }))} />,
    },
    {
      value: "mcp",
      label: "MCP servers",
      noun: "MCP server",
      count: mcp.length,
      description: "Written to a per-execution mcp.json and loaded with --strict-mcp-config. Secrets come from the worker's environment, never from here.",
      body: (
        <EntryTable
          segment="mcp"
          nameWidth="w-[200px]"
          extra={{ label: "Last check", width: "w-[200px]" }}
          rows={mcp.map((s) => ({
            name: s.name,
            detail: s.transport === "stdio" ? `${s.command} ${s.args.join(" ")}` : (s.url ?? ""),
            mono: true,
            version: s.version,
            cell: <CheckBadge check={(s.lastCheck as McpCheck | null) ?? null} />,
          }))}
        />
      ),
    },
    {
      value: "groups",
      label: "Groups",
      noun: "group",
      count: groups.length,
      description: "Named sets of skills, MCP servers and agents, like a skills repository or a plugin. A node that enables a group gets all of them.",
      body: (
        <EntryTable
          segment="groups"
          nameWidth="w-[200px]"
          extra={{ label: "Entries", width: "w-[360px]" }}
          rows={groups.map((g) => ({
            name: g.name,
            detail: g.description || `${g.skills.length + g.mcp.length + g.agents.length} entries`,
            version: g.version,
            cell: <GroupEntries skills={g.skills} mcp={g.mcp} agents={g.agents} />,
          }))}
        />
      ),
    },
  ];
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={[{ label: "Library" }]}
        title="Library"
        description="Skills, MCP servers, subagents and groups of them that graph nodes enable by name."
        actions={
          <>
            <Form action="/library" role="search" className="w-full sm:w-60">
              <input type="hidden" name="tab" value={active} />
              <SearchField type="search" name="q" aria-label="Search the library" placeholder="Search the library" defaultValue={query} />
            </Form>
            <Button variant="outline" asChild>
              <Link href="/library/skills/browse">
                <DownloadIcon data-icon="inline-start" />
                Add skills
              </Link>
            </Button>
            <Button asChild>
              <Link href="/library/skills/new">
                <PlusIcon data-icon="inline-start" />
                New skill
              </Link>
            </Button>
          </>
        }
      />
      <UrlTabs value={active} className="gap-6">
        <TabsList variant="line">
          {sections.map((s) => (
            <TabsTrigger key={s.value} value={s.value}>
              {s.label}
              <span className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-secondary px-[5px] text-[11px] font-semibold text-secondary-foreground tabular-nums">
                {s.count}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {sections.map((s) => (
          <TabsContent key={s.value} value={s.value}>
            <Card className="gap-0 py-0">
              <CardHeader className="px-5 py-4">
                <CardTitle className="text-sm font-semibold">
                  <h2>{s.label}</h2>
                </CardTitle>
                <CardDescription className="text-[13px]">{s.description}</CardDescription>
                {s.value !== "skills" && (
                  <CardAction>
                    <Button size="sm" asChild>
                      <Link href={`/library/${s.value}/new`}>
                        <PlusIcon data-icon="inline-start" />
                        New {s.noun}
                      </Link>
                    </Button>
                  </CardAction>
                )}
              </CardHeader>
              {s.count === 0 ? <NoEntries noun={s.noun} query={query} /> : s.body}
            </Card>
          </TabsContent>
        ))}
      </UrlTabs>
    </main>
  );
}
