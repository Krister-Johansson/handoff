import { ShieldCheckIcon, StarIcon } from "lucide-react";
import { StatusBadge } from "@/components/runs/status-badge";
import type { SkillPageDetails } from "@/server/skills-sh-pages";

const count = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** Audit results in the status colors: pass green, warn amber, anything else red. */
const auditTone = (result: string) => (/^pass/i.test(result) ? "succeeded" : /^(warn|low|medium|unknown)/i.test(result) ? "waiting" : "failed");

/** What skills.sh says about a skill: what it does, how widely it is used, and its security audits. */
export function SkillsShDetails({ details }: { details: SkillPageDetails }) {
  return (
    <div className="grid gap-4 text-sm md:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="flex flex-col gap-2">
        {details.summary && <p>{details.summary}</p>}
        {details.points.length > 0 && (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
            {details.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        )}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] content-start gap-x-4 gap-y-1.5">
        {details.installs !== undefined && (
          <>
            <dt className="text-muted-foreground">Installs</dt>
            <dd className="font-mono">{count.format(details.installs)}</dd>
          </>
        )}
        {details.repository && (
          <>
            <dt className="text-muted-foreground">Repository</dt>
            <dd className="truncate font-mono">
              <a href={`https://github.com/${details.repository}`} className="hover:underline">
                {details.repository}
              </a>
            </dd>
          </>
        )}
        {details.githubStars !== undefined && (
          <>
            <dt className="text-muted-foreground">GitHub stars</dt>
            <dd className="flex items-center gap-1 font-mono">
              <StarIcon aria-hidden className="size-3.5" />
              {count.format(details.githubStars)}
            </dd>
          </>
        )}
        {details.firstSeen && (
          <>
            <dt className="text-muted-foreground">First seen</dt>
            <dd className="font-mono">{details.firstSeen}</dd>
          </>
        )}
        {details.audits.length > 0 && (
          <>
            <dt className="col-span-2 mt-2 flex items-center gap-1 text-muted-foreground">
              <ShieldCheckIcon aria-hidden className="size-3.5" />
              Security audits
            </dt>
            <dd className="col-span-2">
              <ul className="flex flex-col gap-1">
                {details.audits.map((audit) => (
                  <li key={audit.name} className="flex items-center justify-between gap-2">
                    <span>{audit.name}</span>
                    <StatusBadge status={auditTone(audit.result)} label={audit.result} />
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
