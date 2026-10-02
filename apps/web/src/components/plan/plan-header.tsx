import Link from "next/link";
import { ArrowRightIcon, ExternalLinkIcon } from "lucide-react";
import type { PlanProject } from "@handoff/github";
import { PageHeader, type Crumb } from "@/components/page-header";
import { Button } from "@/components/ui/button";

/**
 * The Plan page's header on one line: the title, the GitHub Project as a small link to it, and on the
 * right the link to the Ready tasks in the backlog.
 */
export function PlanHeader({ crumbs, projectId, project, ready }: { crumbs: Crumb[]; projectId: string; project: Pick<PlanProject, "title" | "url">; ready: number }) {
  return (
    <PageHeader
      crumbs={crumbs}
      title="Plan"
      titleExtra={
        <a
          href={project.url}
          title={`Open the GitHub Project ${project.title}`}
          className="inline-flex items-center gap-1 text-[12.5px] font-normal tracking-normal text-muted-foreground hover:text-foreground focus-visible:underline focus-visible:outline-none"
        >
          {project.title}
          <ExternalLinkIcon aria-hidden className="size-3" />
        </a>
      }
      actions={
        <Button variant="link" size="sm" className="h-auto px-0 text-[12.5px]" asChild>
          <Link href={`/projects/${projectId}/issues`}>
            {ready === 1 ? "1 Ready task in the backlog" : `${ready} Ready tasks in the backlog`}
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      }
    />
  );
}
