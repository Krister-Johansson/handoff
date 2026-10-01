import { EntryMain } from "@/components/library/entry-page";
import { entryHeader } from "@/lib/library-entry-header";
import { SkillEditor } from "@/components/library/skill-editor";

export default async function NewSkillPage() {
  const header = await entryHeader({ tab: "skills", title: "New skill", subtitle: "A SKILL.md and its supporting files. Nodes enable it by name." });
  return (
    <EntryMain>
      <SkillEditor header={header} />
    </EntryMain>
  );
}
