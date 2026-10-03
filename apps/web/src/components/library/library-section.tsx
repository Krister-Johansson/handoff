import type { ReactNode } from "react";
import Form from "next/form";
import Link from "next/link";
import { DownloadIcon, PlusIcon } from "lucide-react";
import type { listLibraryIndex } from "@handoff/db";
import type { McpCheck } from "@handoff/engine/mcp-check";
import { GroupEntries } from "@/components/library/group-entries";
import { SearchField } from "@/components/library/search-field";
import { StatusBadge } from "@/components/runs/status-badge";
import { SectionCard } from "@/components/section-card";
import { Tag } from "@/components/tag";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { matchesLibrarySearch } from "@/lib/library-search";
import { CHECK_STATUS } from "@/lib/mcp-check-status";
import { SETTINGS_TAB_LABEL, type LibraryTab } from "@/lib/settings-tab";
import { groupSkillsBySource, type SkillSourceGroup } from "@/lib/skill-sources";
import { cn } from "@/lib/utils";

export type LibraryIndex = Awaited<ReturnType<typeof listLibraryIndex>>;

type Row = { name: string; detail: string; mono?: boolean; extra?: string | undefined; version: number; cell?: ReactNode };
/** A third column some sections add between details and version: an MCP server's last check, a group's entries. */
type Extra = { label: string; width: string };

/** The last check of an MCP server, as a colored pill; "Not tested" before the first one. */
function CheckBadge({ check }: { check: McpCheck | null }) {
  if (!check) return <StatusBadge status="queued" label="Not tested" />;
  const status = CHECK_STATUS[check.status];
  const label = check.status === "ok" ? `${status.label}, ${check.tools.length} tools` : status.label;
  return <StatusBadge status={status.tone} label={label} />;
}

const head = "h-auto px-5 py-[9px] text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase";

/**
 * Entries as a table whose rows open the entry. Tables of one section share column widths, so they line
 * up. On a phone the details column goes, so the name and version fit.
 */
function EntryTable({ segment, rows, extra, nameWidth = "sm:w-[260px]", showHead = true }: { segment: string; rows: Row[]; extra?: Extra; nameWidth?: string; showHead?: boolean }) {
  return (
    <Table className="text-[13px] sm:min-w-[640px] sm:table-fixed">
      <colgroup>
        <col className={nameWidth} />
        <col className="max-sm:hidden" />
        {extra && <col className={extra.width} />}
        <col className="sm:w-20" />
      </colgroup>
      {showHead && (
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={head}>Name</TableHead>
            <TableHead className={cn(head, "max-sm:hidden")}>Details</TableHead>
            {extra && <TableHead className={head}>{extra.label}</TableHead>}
            <TableHead className={cn(head, "text-right")}>Version</TableHead>
          </TableRow>
        </TableHeader>
      )}
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name} className="relative">
            <TableCell className="truncate px-5 py-2.5 font-mono text-xs max-sm:max-w-[150px]">
              <Link href={`/library/${segment}/${encodeURIComponent(row.name)}`} className="after:absolute after:inset-0 hover:underline hover:underline-offset-3">
                {row.name}
              </Link>
            </TableCell>
            <TableCell className={cn("truncate px-5 py-2.5 text-muted-foreground max-sm:hidden", row.mono && "font-mono text-xs")}>
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

type SkillIndexRow = LibraryIndex["skills"][number];
const skillRow = (s: SkillIndexRow): Row => ({ name: s.name, detail: s.description, version: s.version, extra: s.fileCount ? `${s.fileCount + 1} files` : undefined });

/** Skills in one table per source: each skills.sh or GitHub repository, then the skills written here. */
function SkillsBySource({ groups }: { groups: SkillSourceGroup<SkillIndexRow>[] }) {
  return groups.map((group, i) => (
    <section key={`${group.registry}:${group.repo ?? ""}`} aria-label={group.repo ?? "Written here"}>
      {i > 0 && <Separator />}
      <h3 className="flex items-center gap-2 px-5 pt-3 pb-2 text-[13px] font-normal">
        <Tag tone={group.registry !== "local" ? "fill" : "outline"}>{REGISTRY_LABEL[group.registry]}</Tag>
        {group.repo && group.href && (
          <a href={group.href} className="truncate font-mono text-xs hover:underline hover:underline-offset-3">
            {group.repo}
          </a>
        )}
        <span className="text-muted-foreground">{group.skills.length}</span>
        {group.registry === "skills.sh" && group.repo && (
          <Link href={`/library/skills-sh/${group.repo}`} className="ml-auto shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline hover:underline-offset-3">
            Choose skills
          </Link>
        )}
      </h3>
      <EntryTable segment="skills" rows={group.skills.map(skillRow)} showHead={i === 0} />
    </section>
  ));
}

/** What each section shows: its noun, the path segment of its entry pages, its description and its table. */
function sectionOf(tab: LibraryTab, index: LibraryIndex, query: string): { noun: string; segment: string; description: string; count: number; body: ReactNode } {
  switch (tab) {
    case "skills": {
      const skills = index.skills.filter((s) => matchesLibrarySearch([s.name, s.description], query));
      return {
        noun: "skill",
        segment: "skills",
        description: "SKILL.md instructions, with their supporting files, staged into a node's session with --add-dir. Nodes enable them by name.",
        count: skills.length,
        body: <SkillsBySource groups={groupSkillsBySource(skills)} />,
      };
    }
    case "subagents": {
      const agents = index.agents.filter((a) => matchesLibrarySearch([a.name, a.description], query));
      return {
        noun: "agent",
        segment: "agents",
        description: "Subagent definitions passed with --agents, so a node's Claude session can delegate.",
        count: agents.length,
        body: <EntryTable segment="agents" rows={agents.map((a) => ({ name: a.name, detail: a.description, version: a.version }))} />,
      };
    }
    case "mcp": {
      const mcp = index.mcp.filter((s) => matchesLibrarySearch([s.name, s.url ?? "", s.command ?? "", ...s.args], query));
      return {
        noun: "MCP server",
        segment: "mcp",
        description: "Written to a per-execution mcp.json and loaded with --strict-mcp-config. Secrets come from the worker's environment, never from here.",
        count: mcp.length,
        body: (
          <EntryTable
            segment="mcp"
            nameWidth="sm:w-[200px]"
            extra={{ label: "Last check", width: "sm:w-[200px]" }}
            rows={mcp.map((s) => ({
              name: s.name,
              detail: s.transport === "stdio" ? `${s.command} ${s.args.join(" ")}` : (s.url ?? ""),
              mono: true,
              version: s.version,
              cell: <CheckBadge check={(s.lastCheck as McpCheck | null) ?? null} />,
            }))}
          />
        ),
      };
    }
    case "groups": {
      const groups = index.groups.filter((g) => matchesLibrarySearch([g.name, g.description, ...g.skills, ...g.mcp, ...g.agents], query));
      return {
        noun: "group",
        segment: "groups",
        description: "Named sets of skills, MCP servers and agents, like a skills repository or a plugin. A node that enables a group gets all of them.",
        count: groups.length,
        body: (
          <EntryTable
            segment="groups"
            nameWidth="sm:w-[200px]"
            extra={{ label: "Entries", width: "sm:w-[360px]" }}
            rows={groups.map((g) => ({
              name: g.name,
              detail: g.description || `${g.skills.length + g.mcp.length + g.agents.length} entries`,
              version: g.version,
              cell: <GroupEntries skills={g.skills} mcp={g.mcp} agents={g.agents} />,
            }))}
          />
        ),
      };
    }
  }
}

/**
 * One kind of library entry as a section of Settings: skills, subagents, MCP servers or groups that graph
 * nodes enable by name. The search, and Add skills and the New button, sit in the card's header.
 */
export function LibrarySection({ tab, index, query }: { tab: LibraryTab; index: LibraryIndex; query: string }) {
  const section = sectionOf(tab, index, query);
  const label = SETTINGS_TAB_LABEL[tab];
  return (
    <section aria-label={label}>
      <SectionCard
        title={label}
        description={section.description}
        actionBelowOnNarrow
        action={
          <>
            <Form action="/settings" role="search" className="w-full lg:w-56">
              <input type="hidden" name="tab" value={tab} />
              <SearchField type="search" name="q" aria-label="Search the library" placeholder="Search the library" defaultValue={query} className="[&_input]:h-8" />
            </Form>
            {tab === "skills" && (
              <Button size="sm" variant="outline" asChild>
                <Link href="/library/skills/browse">
                  <DownloadIcon data-icon="inline-start" />
                  Add skills
                </Link>
              </Button>
            )}
            <Button size="sm" asChild>
              <Link href={`/library/${section.segment}/new`}>
                <PlusIcon data-icon="inline-start" />
                New {section.noun}
              </Link>
            </Button>
          </>
        }
      >
        {section.count === 0 ? <NoEntries noun={section.noun} query={query} /> : section.body}
      </SectionCard>
    </section>
  );
}
