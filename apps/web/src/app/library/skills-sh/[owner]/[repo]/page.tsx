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
      parents={[
        { label: "Add skills", href: "/library/skills/browse" },
        { label: owner, href: `/library/skills-sh/${owner}` },
      ]}
      subtitle={
        <>
          {`Tick the skills you want in the library and apply. They are kept together in the group ${repoGroupName(repo)}. `}
          <a href={`https://skills.sh/${repo}`} className="hover:underline">
            skills.sh/{repo}
          </a>
        </>
      }
    >
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
