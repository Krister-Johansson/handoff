"use client";

import { useActionState, useState, useTransition } from "react";
import { ChevronDownIcon, DownloadIcon } from "lucide-react";
import { skillDetailsAction, syncRepoAction, type SyncState } from "@/app/library/skills-sh-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SkillsShDetails } from "./skills-sh-details";
import { Tag } from "@/components/tag";

type RepoSkill = { id: string; skillId: string; installs: number };

const installs = new Intl.NumberFormat("en", { notation: "compact" });

type Details = Awaited<ReturnType<typeof skillDetailsAction>>;

function SkillRow({
  skill,
  ticked,
  inLibrary,
  expanded,
  onTick,
  onExpand,
}: {
  skill: RepoSkill;
  ticked: boolean;
  inLibrary: boolean;
  expanded: boolean;
  onTick: (on: boolean) => void;
  onExpand: () => void;
}) {
  const [details, setDetails] = useState<Details>();
  const [loading, startLoading] = useTransition();
  const expand = () => {
    // Details are fetched from skills.sh the first time the row opens.
    if (!expanded && !details) startLoading(async () => setDetails(await skillDetailsAction(skill.id)));
    onExpand();
  };
  return (
    <li className="border-t first:border-t-0">
      <div className="grid grid-cols-[15px_minmax(0,1fr)_auto_auto] items-center gap-3 px-5 py-2.5 hover:bg-muted/50">
        <Checkbox id={`pick-${skill.skillId}`} aria-label={skill.skillId} checked={ticked} onCheckedChange={(on) => onTick(on === true)} />
        <span className="flex min-w-0 items-center gap-2">
          <label htmlFor={`pick-${skill.skillId}`} className="truncate font-mono text-[13px]">
            {skill.skillId}
          </label>
          {inLibrary && <Tag>in library</Tag>}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">{installs.format(skill.installs)} installs</span>
        <Button type="button" size="sm" variant={expanded ? "outline" : "ghost"} aria-label={`Details of ${skill.skillId}`} aria-expanded={expanded} onClick={expand}>
          <ChevronDownIcon data-icon="inline-start" className={cn("transition-transform", expanded && "rotate-180")} />
          Details
        </Button>
      </div>
      {expanded && (
        <div className="border-t bg-subtle py-3 pr-5 pl-12">
          {loading || !details ? (
            <Skeleton className="h-24 w-full" />
          ) : "error" in details ? (
            <FieldError>{details.error}</FieldError>
          ) : (
            <SkillsShDetails details={details.details} />
          )}
        </div>
      )}
    </li>
  );
}

/** A skills.sh repository's skills with checkboxes: ticked is in the library. Apply adds and removes to match. */
export function SkillsShRepoPicker({ repo, skills, installed }: { repo: string; skills: RepoSkill[]; installed: string[] }) {
  const [state, action, pending] = useActionState(syncRepoAction, {} as SyncState);
  const [ticked, setTicked] = useState(() => new Set(installed));
  // When the page brings a new library state (after Apply), the ticks start from it again.
  const installedKey = installed.join("\n");
  const [seen, setSeen] = useState(installedKey);
  if (seen !== installedKey) {
    setSeen(installedKey);
    setTicked(new Set(installed));
  }
  const inLibrary = new Set(installed);
  const [expanded, setExpanded] = useState<string | null>(null);
  const adding = [...ticked].filter((id) => !inLibrary.has(id)).length;
  const removing = installed.filter((id) => !ticked.has(id)).length;
  const toggle = (id: string, on: boolean) => {
    const next = new Set(ticked);
    if (on) next.add(id);
    else next.delete(id);
    setTicked(next);
  };
  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-0 py-0">
        <ul className="flex flex-col">
          {skills.map((s) => (
            <SkillRow
              key={s.skillId}
              skill={s}
              ticked={ticked.has(s.skillId)}
              inLibrary={inLibrary.has(s.skillId)}
              expanded={expanded === s.skillId}
              onTick={(on) => toggle(s.skillId, on)}
              onExpand={() => setExpanded(expanded === s.skillId ? null : s.skillId)}
            />
          ))}
        </ul>
      </Card>
      {state.error && <FieldError>{state.error}</FieldError>}
      {state.report && (
        <p role="status" className="text-sm text-muted-foreground">
          {[
            state.report.added.length ? `Added ${state.report.added.join(", ")}.` : "",
            state.report.removed.length ? `Removed ${state.report.removed.join(", ")}.` : "",
            state.report.failed.map((f) => `${f.skillId}: ${f.reason}`).join(" "),
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      )}
      {/* The checkboxes stay outside the form: React resets a form after its action, and a Radix checkbox
          inside it would then fall back to its initial state. The form carries the ticks as hidden inputs. */}
      <form action={action} className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-input bg-popover px-3.5 py-2.5 shadow-lg">
        <input type="hidden" name="repo" value={repo} />
        {skills.filter((s) => ticked.has(s.skillId)).map((s) => (
          <input key={s.skillId} type="hidden" name="want" value={s.skillId} />
        ))}
        <span className="text-sm font-medium">
          {ticked.size} of {skills.length} in the library
        </span>
        <span className="text-xs text-muted-foreground">{`Add ${adding}, remove ${removing}`}</span>
        <span className="ml-auto flex gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => setTicked(new Set(skills.map((s) => s.skillId)))}>
            Select all
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setTicked(new Set())}>
            Select none
          </Button>
        </span>
        <Button type="submit" disabled={pending || adding + removing === 0}>
          <DownloadIcon data-icon="inline-start" />
          {pending ? "Applying" : "Apply"}
        </Button>
      </form>
    </div>
  );
}
