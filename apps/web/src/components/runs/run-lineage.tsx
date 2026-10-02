import Link from "next/link";
import { RedoIcon, UndoIcon } from "lucide-react";
import { runPath } from "@/lib/paths";

const linkClass = "inline-flex items-center gap-[5px] hover:text-foreground hover:underline hover:underline-offset-3";

/** The runs Run again linked to this one: the run it continues from its branch, and the run started in its place. */
export function RunLineage({ projectId, continues, supersededBy }: { projectId: string; continues: string | null; supersededBy: string | null }) {
  if (!continues && !supersededBy) return null;
  return (
    <>
      {continues && (
        <Link href={runPath(projectId, continues)} className={linkClass}>
          <UndoIcon aria-hidden />
          continues run <span className="font-mono">{continues.slice(0, 8)}</span>
        </Link>
      )}
      {supersededBy && (
        <Link href={runPath(projectId, supersededBy)} className={linkClass}>
          <RedoIcon aria-hidden />
          superseded by run <span className="font-mono">{supersededBy.slice(0, 8)}</span>
        </Link>
      )}
    </>
  );
}
