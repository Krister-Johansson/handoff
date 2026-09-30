import { SkillsShClient } from "@/server/skills-sh";
import { SkillsShDetails } from "./skills-sh-details";

/** skills.sh's details of an imported skill, fetched on the server. skills.sh being down never breaks the page. */
export async function SkillsShDetailsSection({ id }: { id: string }) {
  const details = await new SkillsShClient().skillDetails(id).catch((error: Error) => error);
  return (
    <section aria-label="On skills.sh" className="rounded-lg border p-4">
      <h2 className="mb-3 text-sm font-medium">On skills.sh</h2>
      {details instanceof Error ? <p className="text-sm text-muted-foreground">skills.sh did not answer: {details.message}</p> : <SkillsShDetails details={details} />}
    </section>
  );
}
