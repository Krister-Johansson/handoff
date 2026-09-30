import { EntryPage } from "@/components/library/entry-page";
import { RepoImport } from "@/components/library/repo-import";
import { SkillsShBrowser } from "@/components/library/skills-sh-browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function BrowseSkillsPage() {
  return (
    <EntryPage tab="skills" kind="skill" title="Add skills" subtitle="Import one skill from skills.sh, or a whole GitHub repository of skills as a group.">
      <Card>
        <CardHeader>
          <CardTitle>Import a GitHub repository</CardTitle>
          <CardDescription>For repositories of skills such as anthropics/skills or vercel-labs/agent-skills.</CardDescription>
        </CardHeader>
        <CardContent>
          <RepoImport />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Search skills.sh</CardTitle>
          <CardDescription>Import a single skill with all its files. The library remembers where it came from, so it can update it later.</CardDescription>
        </CardHeader>
        <CardContent>
          <SkillsShBrowser />
        </CardContent>
      </Card>
    </EntryPage>
  );
}
