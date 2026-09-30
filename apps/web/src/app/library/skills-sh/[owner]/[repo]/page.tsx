import Link from "next/link";
import { listLibraryIndex } from "@handoff/db";
import { EntryPage } from "@/components/library/entry-page";
import { SkillsShRepoPicker } from "@/components/library/skills-sh-repo-picker";
import { Card, CardContent } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field";
import { getDb } from "@/lib/db";
import { SkillsShClient } from "@/server/skills-sh";
import { repoGroupName } from "@/server/skills-sh-sync";

export const dynamic = "force-dynamic";

export default async function SkillsShRepoPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo: name } = await params;
  const repo = `${owner}/${name}`;
  const [skills, index] = await Promise.all([
    new SkillsShClient().repository(repo).catch((error: Error) => error),
    listLibraryIndex(getDb()),
  ]);
  const installed = index.skills
    .filter((s) => s.source?.registry === "skills.sh" && s.source.id.startsWith(`${repo}/`))
    .map((s) => s.source!.id.slice(repo.length + 1));
  return (
    <EntryPage
      tab="skills"
      kind="skill"
      title={repo}
      subtitle={`Tick the skills you want in the library and apply. They are kept together in the group ${repoGroupName(repo)}.`}
    >
      <p className="-mt-4 text-sm text-muted-foreground">
        <Link href={`/library/skills-sh/${owner}`} className="hover:underline">
          All of {owner}&apos;s repositories
        </Link>
        {" · "}
        <a href={`https://skills.sh/${repo}`} className="hover:underline">
          skills.sh/{repo}
        </a>
      </p>
      {skills instanceof Error ? (
        <FieldError>{skills.message}</FieldError>
      ) : (
        <Card>
          <CardContent>
            <SkillsShRepoPicker repo={repo} skills={skills} installed={installed} />
          </CardContent>
        </Card>
      )}
    </EntryPage>
  );
}
