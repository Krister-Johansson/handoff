"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProjectTab } from "@/lib/project-tab";

/** A count beside a tab or filter, as a small grey pill. */
export const Count = ({ n }: { n: number }) => (
  <span className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-secondary px-1 text-[11px] font-semibold text-secondary-foreground tabular-nums">{n}</span>
);

/** Runs, Issues, Pull requests, Graphs and Settings; the server renders only the active tab, chosen by ?tab=. */
export function ProjectTabs({
  active,
  counts,
  issueCount,
  children,
}: {
  active: ProjectTab;
  /** `ready`: pull requests in the merge queue. */
  counts: { runs: number; pulls: number; graphs: number; ready?: number };
  /** The open issue count, which comes from GitHub and streams in after the page. */
  issueCount?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Tabs value={active} onValueChange={(tab) => router.push(`?tab=${tab}`, { scroll: false })} className="gap-4">
      <TabsList variant="line">
        <TabsTrigger value="runs">
          Runs <Count n={counts.runs} />
        </TabsTrigger>
        <TabsTrigger value="issues">Issues {issueCount}</TabsTrigger>
        <TabsTrigger value="pulls">
          Pull requests <Count n={counts.pulls} />
          {counts.ready ? (
            <span className="inline-flex h-[17px] items-center rounded-full bg-success-bg px-1.5 text-[11px] font-semibold text-success tabular-nums">{counts.ready} ready</span>
          ) : null}
        </TabsTrigger>
        <TabsTrigger value="graphs">
          Graphs <Count n={counts.graphs} />
        </TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value={active}>{children}</TabsContent>
    </Tabs>
  );
}
