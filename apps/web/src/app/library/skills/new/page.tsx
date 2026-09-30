import { EntryPage } from "@/components/library/entry-page";
import { SkillEditor } from "@/components/library/skill-editor";

export default function NewSkillPage() {
  return (
    <EntryPage tab="skills" kind="skill" title="New skill" subtitle="A SKILL.md and its supporting files. Nodes enable it by name.">
      <SkillEditor />
    </EntryPage>
  );
}
