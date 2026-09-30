import { notFound } from "next/navigation";
import { getLibraryByNames } from "@handoff/db";
import { EntryPage } from "@/components/library/entry-page";
import { SkillEditor } from "@/components/library/skill-editor";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SkillPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const [skill] = (await getLibraryByNames(getDb(), { skills: [decodeURIComponent(name)], mcp: [], agents: [] })).skills;
  if (!skill) notFound();
  return (
    <EntryPage tab="skills" kind="skill" title={skill.name} subtitle="Saving creates a new version. Runs already started keep the version they staged." name={skill.name} version={skill.version}>
      <SkillEditor skill={{ name: skill.name, description: skill.description, body: skill.body, frontmatter: skill.frontmatter, files: skill.files }} />
    </EntryPage>
  );
}
