import { SkillsShClient } from "@/server/skills-sh";
import { SkillsShDetails } from "./skills-sh-details";

/** skills.sh's details of an imported skill, fetched on the server. skills.sh being down never breaks the page. */
export async function SkillsShDetailsSection({ id }: { id: string }) {
  const details = await new SkillsShClient().skillDetails(id).catch((error: Error) => error);
  return (
    <section aria-label="On skills.sh" className="rounded-xl bg-card px-5 py-4 ring-1 ring-border">
      <h2 className="mb-3 text-sm font-semibold">On skills.sh</h2>
      {details instanceof Error ? <p className="text-sm text-muted-foreground">skills.sh did not answer: {details.message}</p> : <SkillsShDetails details={details} />}
    </section>
  );
}
