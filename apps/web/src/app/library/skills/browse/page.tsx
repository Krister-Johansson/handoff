import { EntryPage } from "@/components/library/entry-page";
import { SkillsShBrowser } from "@/components/library/skills-sh-browser";

export default function BrowseSkillsPage() {
  return (
    <EntryPage tab="skills" kind="skill" title="Browse skills.sh" subtitle="Import a skill with all its files. The library remembers where it came from, so it can update it later.">
      <SkillsShBrowser />
    </EntryPage>
  );
}
