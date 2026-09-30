import { AddProjectDialog } from "@/components/projects/add-project-dialog";
import { ProjectCard } from "@/components/projects/project-card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { getDb } from "@/lib/db";
import { listProjects } from "@/server/graphs";
import { projectAttention } from "@/server/project-admin";

export const dynamic = "force-dynamic";

const CALM = { questions: 0, failed: 0, reviews: 0, waitingOnCi: 0, running: 0 };

export default async function ProjectsPage() {
  const db = getDb();
  const [projects, attention] = await Promise.all([listProjects(db), projectAttention(db)]);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
            <p className="text-muted-foreground">A project is a GitHub repository with its graphs and runs.</p>
          </div>
          <AddProjectDialog />
        </div>
        {projects.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No projects yet</EmptyTitle>
              <EmptyDescription>Add the repository handoff should work on.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} attention={attention[p.id] ?? CALM} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
