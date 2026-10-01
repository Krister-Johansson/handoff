import type { ReactNode } from "react";
import Link from "next/link";
import { FolderGit2Icon, InboxIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ActiveRunList } from "@/components/projects/active-runs";
import { ROW, ROWS, SectionCard, Tag } from "@/components/projects/section-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { getDb } from "@/lib/db";
import { formatCost } from "@/lib/format";
import { activeSummary, needsYouSummary } from "@/lib/overview-summary";
import { cn } from "@/lib/utils";
import { listProjects } from "@/server/graphs";
import { homeSummary } from "@/server/home";
import { listInbox } from "@/server/inbox";
import { projectAttention } from "@/server/project-admin";
import { runLines } from "@/server/run-lines";

export const dynamic = "force-dynamic";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One of the three numbers at the top: a label, the number with a note beside it, and a line under it. */
function Stat({ label, value, note, foot, className }: { label: string; value: number; note?: string; foot?: ReactNode; className?: string }) {
  return (
    <Card className={cn("h-full gap-2.5 px-5 py-[18px]", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-2 text-[30px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
        {value}
        {note && <small className="text-[13px] font-normal tracking-normal text-muted-foreground">{note}</small>}
      </span>
      {foot && <span className="mt-0.5 text-xs text-muted-foreground">{foot}</span>}
    </Card>
  );
}

export default async function Home() {
  const db = getDb();
  const [summary, inbox, projects, attention] = await Promise.all([homeSummary(db), listInbox(db), listProjects(db), projectAttention(db)]);
  const lines = await runLines(
    db,
    summary.activeRuns.map((r) => r.id),
  );
  const activeProjects = new Set(summary.activeRuns.map((r) => r.projectId)).size;
  const { recent } = summary;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        crumbs={[{ label: "Overview" }]}
        title="Overview"
        description="Graph runs for coding agents: plan, code, test, review, pull request, merge."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/projects">
                <FolderGit2Icon data-icon="inline-start" />
                Projects
              </Link>
            </Button>
            <Button asChild>
              <Link href="/inbox">
                <InboxIcon data-icon="inline-start" />
                Open inbox
              </Link>
            </Button>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-3">
        <Link href="/inbox" className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Stat label="Needs you" value={inbox.count} foot={needsYouSummary(inbox)} className="transition-colors group-hover:bg-muted" />
        </Link>
        <Stat
          label="Active runs"
          value={summary.activeRuns.length}
          note={activeProjects > 0 ? `across ${plural(activeProjects, "project")}` : undefined}
          foot={activeSummary(summary.activeRuns)}
        />
        <Stat
          label="Last 7 days"
          value={recent.succeeded}
          note="merged or finished"
          foot={[`${recent.failed} failed`, `${recent.cancelled} cancelled`, recent.costUsd > 0 && `${formatCost(recent.costUsd)} est.`].filter(Boolean).join(" · ")}
        />
      </section>

      <SectionCard title="Active runs" description="Queued, running, or waiting on CI, a review or an answer.">
        {summary.activeRuns.length === 0 ? (
          <Empty className="pt-2 pb-9">
            <EmptyHeader>
              <EmptyTitle>Nothing running</EmptyTitle>
              <EmptyDescription>Start a run from a project&apos;s graph.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild>
                <Link href="/projects">
                  <FolderGit2Icon data-icon="inline-start" />
                  Projects
                </Link>
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <ActiveRunList runs={summary.activeRuns} lines={lines} />
        )}
      </SectionCard>

      {projects.length > 0 && (
        <SectionCard
          title="Projects"
          description="A project is a GitHub repository with its graphs and runs."
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href="/projects">All projects</Link>
            </Button>
          }
        >
          <ul className={ROWS}>
            {projects.map((p) => {
              const a = attention[p.id];
              const needs = a ? a.questions + a.failed + a.reviews : 0;
              return (
                <li key={p.id} className={ROW}>
                  <div className="flex min-w-0 flex-1 flex-col gap-px">
                    <Link href={`/projects/${p.id}`} className="truncate font-medium hover:underline hover:underline-offset-3">
                      {p.name}
                    </Link>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {p.repoOwner}/{p.repoName} · {p.defaultBranch}
                    </span>
                  </div>
                  {p.isDemo && <Tag tone="fill">demo</Tag>}
                  {needs > 0 && <Tag tone="attention">Needs you · {needs}</Tag>}
                  <Tag>{plural(p.runCount, "run")}</Tag>
                  {p.activeRuns > 0 && <Tag>{p.activeRuns} active</Tag>}
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}
    </main>
  );
}
