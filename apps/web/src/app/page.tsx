import Link from "next/link";
import { FolderGit2Icon, InboxIcon, PlayIcon } from "lucide-react";
import { StatusBadge } from "@/components/runs/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { getDb } from "@/lib/db";
import { homeSummary } from "@/server/home";
import { listInbox } from "@/server/inbox";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = getDb();
  const [summary, inbox] = await Promise.all([homeSummary(db), listInbox(db)]);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">handoff</h1>
          <p className="text-muted-foreground">Graph runs for coding agents: plan, code, test, review, pull request, merge.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Needs you</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{inbox.count}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" asChild>
              <Link href="/inbox">
                <InboxIcon data-icon="inline-start" />
                Open inbox
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Active runs</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{summary.activeRuns.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" asChild>
              <Link href="/runs">
                <PlayIcon data-icon="inline-start" />
                All runs
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Last 7 days</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary.recent.succeeded} <span className="text-base font-normal text-muted-foreground">merged or finished</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {summary.recent.failed} failed · {summary.recent.cancelled} cancelled
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active runs</CardTitle>
          <CardDescription>Queued, running, or waiting on CI, a review or an answer.</CardDescription>
        </CardHeader>
        <CardContent>
          {summary.activeRuns.length === 0 ? (
            <Empty>
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
            <ul className="flex flex-col divide-y">
              {summary.activeRuns.map((run) => (
                <li key={run.id} className="flex items-center gap-3 py-2">
                  <StatusBadge status={run.status} />
                  <Link href={`/runs/${run.id}`} className="min-w-0 flex-1 truncate hover:underline">
                    {run.task}
                  </Link>
                  <span className="shrink-0 text-sm text-muted-foreground">{run.project}</span>
                  {run.prNumber !== null && <span className="shrink-0 font-mono text-xs text-muted-foreground">PR #{run.prNumber}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
