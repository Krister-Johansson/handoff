"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProjectTab } from "@/lib/project-tab";

export const Count = ({ n }: { n: number }) => <span className="ml-1 rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">{n}</span>;

/** Runs, Issues, Pull requests, Graphs and Settings; the server renders only the active tab, chosen by ?tab=. */
export function ProjectTabs({
  active,
  counts,
  issueCount,
  children,
}: {
  active: ProjectTab;
  counts: { runs: number; pulls: number; graphs: number };
  /** The open issue count, which comes from GitHub and streams in after the page. */
  issueCount?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Tabs value={active} onValueChange={(tab) => router.push(`?tab=${tab}`, { scroll: false })} className="gap-4">
      <TabsList>
        <TabsTrigger value="runs">
          Runs <Count n={counts.runs} />
        </TabsTrigger>
        <TabsTrigger value="issues">Issues {issueCount}</TabsTrigger>
        <TabsTrigger value="pulls">
          Pull requests <Count n={counts.pulls} />
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
