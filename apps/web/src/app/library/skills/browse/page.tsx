import { EntryCard, EntryPage } from "@/components/library/entry-page";
import { OpenSkillsSh } from "@/components/library/open-skills-sh";
import { RepoImport } from "@/components/library/repo-import";
import { SkillsShBrowser } from "@/components/library/skills-sh-browser";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function BrowseSkillsPage() {
  return (
    <EntryPage tab="skills" kind="skill" title="Add skills" subtitle="From skills.sh, by owner, repository or search, or from any GitHub repository of skills.">
      <Card className="gap-0 py-0">
        <CardHeader className="px-5 py-4">
          <CardTitle className="text-sm font-semibold">
            <h2>skills.sh</h2>
          </CardTitle>
          <CardDescription className="text-[13px]">Open an owner or a repository to tick the skills you want, or search every skill on skills.sh.</CardDescription>
        </CardHeader>
        <SkillsShBrowser lead={<OpenSkillsSh />} />
      </Card>
      <EntryCard title="Import a GitHub repository" description="For repositories of skills that are not on skills.sh, or to take a whole repository at once.">
        <RepoImport />
      </EntryCard>
    </EntryPage>
  );
}
