import Link from "next/link";
import { CircleDotIcon, CloudOffIcon, PlayIcon, SearchXIcon } from "lucide-react";
import { SidebarSection } from "@/components/sidebar-section";
import { TopBarCrumbs } from "@/components/top-bar";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { projectPath } from "@/lib/paths";
import type { IssueRun } from "@/server/issue-page";
import { issueCrumbs, type ProjectRef } from "./issue-crumbs";
import { IssueRuns } from "./issue-runs";
import { IssueSection, OpenOnGitHub, RailSection } from "./issue-section";
import { IssueColumns } from "./issue-columns";
import { TryAgain } from "./try-again";
import { WaitingCrumbs } from "./waiting-crumbs";

function Lines({ widths }: { widths: string[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {widths.map((w) => (
        <Skeleton key={w} className="h-3.5" style={{ width: w }} />
      ))}
    </div>
  );
}

/**
 * While GitHub is read: the number from the address and the runs from handoff at once, GitHub's parts
 * as skeletons beside "Reading #16 from GitHub". The sidebar keeps the item of the page before.
 */
/** `at` is when the runs were read, in epoch milliseconds. */
export function IssueLoading({ project, number, runs, at }: { project: ProjectRef; number: number; runs: IssueRun[] | undefined; at: number }) {
  return (
    <div className="flex flex-col gap-5">
      <WaitingCrumbs project={project} number={number} />
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 basis-80 flex-col gap-2">
            <span className="flex items-center gap-2">
              <Skeleton className="h-5 w-11" />
              <span className="font-mono text-[13px] text-muted-foreground">#{number}</span>
            </span>
            <Skeleton className="h-7 w-[min(28rem,100%)]" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-14" />
          <Skeleton className="h-3 w-36" />
          <span role="status" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Spinner role="presentation" aria-label={undefined} aria-hidden className="size-3.5" />
            Reading #{number} from GitHub
          </span>
        </div>
      </header>
      <IssueColumns
        first={
          runs === undefined ? (
            <IssueSection title="Runs">
              <Lines widths={["60%", "85%", "40%"]} />
            </IssueSection>
          ) : runs.length > 0 ? (
            <IssueRuns runs={runs} projectId={project.id} now={new Date(at)} />
          ) : null
        }
        rail={
          <aside aria-label="Where the issue sits" className="min-w-0 [grid-area:rail] lg:self-start">
            <Card className="gap-0 py-0">
              {["In the plan", "Part of", "Blocked by"].map((title) => (
                <RailSection key={title} title={title}>
                  <Lines widths={["70%", "90%"]} />
                </RailSection>
              ))}
            </Card>
          </aside>
        }
        rest={
          <IssueSection title="Description">
            <Lines widths={["95%", "88%", "60%", "92%", "45%"]} />
          </IssueSection>
        }
      />
    </div>
  );
}

/** GitHub did not answer: the title the latest run linked stands in, the runs stay, and Try again reads GitHub again. */
export function IssueUnreachable({ project, number, title, runs, now }: { project: ProjectRef; number: number; title: string | null; runs: IssueRun[]; now: Date }) {
  const from = runs.find((r) => r.issueTitle);
  return (
    <div className="flex flex-col gap-5">
      <SidebarSection section="issues" />
      <TopBarCrumbs crumbs={issueCrumbs(project, "issues", `#${number}`)} />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
          <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <span className="font-mono">#{number}</span>
            {title && from && (
              <span className="inline-flex items-center gap-1">
                <PlayIcon aria-hidden className="size-3" />
                title from run {from.id.slice(0, 8)}
              </span>
            )}
          </span>
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] break-words">{title ?? `Issue #${number}`}</h1>
        </div>
        <OpenOnGitHub url={`https://github.com/${project.repo}/issues/${number}`} />
      </header>
      <Alert variant="destructive" className="border-danger-dot/30 bg-danger-bg px-4 py-3">
        <CloudOffIcon aria-hidden />
        <AlertTitle className="text-foreground">GitHub did not answer</AlertTitle>
        <AlertDescription className="text-foreground/80">
          handoff could not read #{number} from {project.repo}. The description, the plan and the comments need GitHub. The runs below come from handoff.
        </AlertDescription>
        <AlertAction className="top-3 right-3">
          <TryAgain />
        </AlertAction>
      </Alert>
      {runs.length > 0 && <IssueRuns runs={runs} projectId={project.id} now={now} />}
    </div>
  );
}

/** A number that is not an issue of the repository. */
export function IssueNotFound({ project, number }: { project: ProjectRef; number: number }) {
  return (
    <div className="flex flex-col gap-5">
      <SidebarSection section="issues" />
      <TopBarCrumbs crumbs={issueCrumbs(project, "issues", `#${number}`)} />
      <Card className="py-0">
        <CardContent className="p-0">
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon />
              </EmptyMedia>
              <EmptyTitle>
                No issue #{number} in {project.repo}
              </EmptyTitle>
              <EmptyDescription>Check the number. A pull request number opens its pull request instead.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row justify-center gap-2">
              <Button variant="outline" asChild>
                <Link href={projectPath(project.id, "plan")}>Open the plan</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={projectPath(project.id, "issues")}>
                  <CircleDotIcon data-icon="inline-start" />
                  Open Issues
                </Link>
              </Button>
            </EmptyContent>
          </Empty>
        </CardContent>
      </Card>
    </div>
  );
}
