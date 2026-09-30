import { EntryPage } from "@/components/library/entry-page";
import { OpenSkillsSh } from "@/components/library/open-skills-sh";
import { RepoImport } from "@/components/library/repo-import";
import { SkillsShBrowser } from "@/components/library/skills-sh-browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function BrowseSkillsPage() {
  return (
    <EntryPage tab="skills" kind="skill" title="Add skills" subtitle="From skills.sh, by owner, repository or search, or from any GitHub repository of skills.">
      <Card>
        <CardHeader>
          <CardTitle>skills.sh</CardTitle>
          <CardDescription>Open an owner or a repository to tick the skills you want, or search every skill on skills.sh.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <OpenSkillsSh />
          <SkillsShBrowser />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Import a GitHub repository</CardTitle>
          <CardDescription>For repositories of skills that are not on skills.sh, or to take a whole repository at once.</CardDescription>
        </CardHeader>
        <CardContent>
          <RepoImport />
        </CardContent>
      </Card>
    </EntryPage>
  );
}
