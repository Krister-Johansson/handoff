import Link from "next/link";
import { NewProjectForm } from "@/components/projects/forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { getDb } from "@/lib/db";
import { listProjects } from "@/server/graphs";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await listProjects(getDb());
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted-foreground">A project is a GitHub repository with its graphs and runs.</p>
        </div>
        {projects.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No projects yet</EmptyTitle>
              <EmptyDescription>Add the repository handoff should work on.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <Card className="h-full transition-colors hover:bg-muted/50">
                  <CardHeader>
                    <CardTitle>{p.name}</CardTitle>
                    <CardDescription className="font-mono text-xs">
                      {p.repoOwner}/{p.repoName} · {p.defaultBranch}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex gap-2">
                    <Badge variant="outline">{p.runCount} runs</Badge>
                    {p.isDemo && <Badge variant="secondary">demo</Badge>}
                    {p.activeRuns > 0 && <Badge variant="secondary">{p.activeRuns} active</Badge>}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Add a project</CardTitle>
          <CardDescription>The worker clones it and opens pull requests there.</CardDescription>
        </CardHeader>
        <CardContent>
          <NewProjectForm />
        </CardContent>
      </Card>
    </main>
  );
}
