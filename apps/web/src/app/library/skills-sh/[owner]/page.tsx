import Link from "next/link";
import { listLibraryIndex } from "@handoff/db";
import { EntryPage } from "@/components/library/entry-page";
import { Tag } from "@/components/library/tag";
import { Card } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field";
import { getDb } from "@/lib/db";
import { SkillsShClient } from "@/server/skills-sh";

export const dynamic = "force-dynamic";

export default async function SkillsShOwnerPage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner } = await params;
  const [repos, index] = await Promise.all([
    new SkillsShClient().owner(owner).catch((error: Error) => error),
    listLibraryIndex(getDb()),
  ]);
  const inLibrary = (repo: string) => index.skills.filter((s) => s.source?.registry === "skills.sh" && s.source.id.startsWith(`${repo}/`)).length;
  return (
    <EntryPage tab="skills" kind="skill" title={owner} parents={[{ label: "Add skills", href: "/library/skills/browse" }]} subtitle="Repositories this owner publishes on skills.sh. Open one to choose its skills.">
      {repos instanceof Error ? (
        <FieldError>{repos.message}</FieldError>
      ) : (
        <Card className="gap-0 py-0">
          <ul className="flex flex-col">
            {repos.map((r) => (
              <li key={r.repo} className="border-t first:border-t-0">
                <Link href={`/library/skills-sh/${r.repo}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/50">
                  <span className="font-mono text-[13px]">{r.repo}</span>
                  <span className="text-xs text-muted-foreground">{r.skills} skills</span>
                  {inLibrary(r.repo) > 0 && (
                    <Tag fill className="ml-auto">
                      {inLibrary(r.repo)} in library
                    </Tag>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </EntryPage>
  );
}
