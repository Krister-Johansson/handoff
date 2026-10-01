import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getLibraryByNames } from "@handoff/db";
import { EntryMain, UsedByGroups } from "@/components/library/entry-page";
import { entryHeader } from "@/lib/library-entry-header";
import { SkillEditor } from "@/components/library/skill-editor";
import { SkillSource } from "@/components/library/skill-source";
import { SkillsShDetailsSection } from "@/components/library/skills-sh-details-section";
import { Skeleton } from "@/components/ui/skeleton";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SkillPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const [skill] = (await getLibraryByNames(getDb(), { skills: [decodeURIComponent(name)], mcp: [], agents: [] })).skills;
  if (!skill) notFound();
  const header = await entryHeader({
    tab: "skills",
    title: skill.name,
    subtitle: "Saving creates a new version. Runs already started keep the version they staged.",
    name: skill.name,
    version: skill.version,
    source: skill.source?.registry ?? "local",
  });
  return (
    <EntryMain>
      <SkillEditor
        key={skill.version}
        header={header}
        version={skill.version}
        skill={{ name: skill.name, description: skill.description, body: skill.body, frontmatter: skill.frontmatter, files: skill.files }}
      >
        {skill.source && <SkillSource source={skill.source} />}
        {skill.source?.registry === "skills.sh" && (
          <Suspense fallback={<Skeleton className="h-40 w-full" />}>
            <SkillsShDetailsSection id={skill.source.id} />
          </Suspense>
        )}
      </SkillEditor>
      <UsedByGroups kind="skills" name={skill.name} />
    </EntryMain>
  );
}
