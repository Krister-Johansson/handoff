import Link from "next/link";
import { PencilIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAgo } from "@/lib/format";
import { GraphSettingsDialog } from "./forms";

export type GraphRow = { id: string; name: string; latestVersion: number; savedAt: Date; runs: number };

/** The project's graphs, each opening in the editor, with the one new runs use marked as the default. */
export function GraphList({ projectId, graphs, defaultGraph, now = new Date() }: { projectId: string; graphs: GraphRow[]; defaultGraph: string | undefined; now?: Date }) {
  if (graphs.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No graphs yet</EmptyTitle>
          <EmptyDescription>Create one from a template with New graph.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Graph</TableHead>
          <TableHead>Version</TableHead>
          <TableHead>Saved</TableHead>
          <TableHead>Runs</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {graphs.map((g) => {
          const href = `/projects/${projectId}/graphs/${encodeURIComponent(g.name)}`;
          return (
            <TableRow key={g.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Link href={href} className="font-mono hover:underline">
                    {g.name}
                  </Link>
                  {g.name === defaultGraph && (
                    <Badge variant="secondary" title="New runs use this graph unless you pick another">
                      default
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline">v{g.latestVersion}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground" title={g.savedAt.toISOString()}>
                saved {formatAgo(g.savedAt, now)}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">{g.runs === 0 ? "no runs" : `${g.runs} run${g.runs === 1 ? "" : "s"}`}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={href}>
                      <PencilIcon data-icon="inline-start" />
                      Edit
                    </Link>
                  </Button>
                  <GraphSettingsDialog projectId={projectId} graphName={g.name} />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
