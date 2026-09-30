"use client";

import { useActionState, useState, useTransition } from "react";
import { ChevronDownIcon } from "lucide-react";
import { skillDetailsAction, syncRepoAction, type SyncState } from "@/app/library/skills-sh-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { SkillsShDetails } from "./skills-sh-details";

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
    <>
      <TableRow>
        <TableCell>
          <Checkbox id={`pick-${skill.skillId}`} aria-label={skill.skillId} checked={ticked} onCheckedChange={(on) => onTick(on === true)} />
        </TableCell>
        <TableCell className="w-full">
          <label htmlFor={`pick-${skill.skillId}`} className="font-mono text-sm">
            {skill.skillId}
          </label>
          {inLibrary && (
            <Badge variant="secondary" className="ml-2">
              in library
            </Badge>
          )}
        </TableCell>
        <TableCell className="text-right text-muted-foreground tabular-nums">{installs.format(skill.installs)}</TableCell>
        <TableCell>
          <Button type="button" size="icon-sm" variant="ghost" aria-label={`Details of ${skill.skillId}`} aria-expanded={expanded} onClick={expand}>
            <ChevronDownIcon className={cn("transition-transform", expanded && "rotate-180")} />
          </Button>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={4} className="whitespace-normal">
            {loading || !details ? (
              <Skeleton className="h-24 w-full" />
            ) : "error" in details ? (
              <FieldError>{details.error}</FieldError>
            ) : (
              <SkillsShDetails details={details.details} />
            )}
          </TableCell>
        </TableRow>
      )}
    </>
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
      {/* The checkboxes stay outside the form: React resets a form after its action, and a Radix checkbox
          inside it would then fall back to its initial state. The form carries the ticks as hidden inputs. */}
      <form action={action} className="contents">
        <input type="hidden" name="repo" value={repo} />
        {skills.filter((s) => ticked.has(s.skillId)).map((s) => (
          <input key={s.skillId} type="hidden" name="want" value={s.skillId} />
        ))}
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-background/95 px-3 py-2 backdrop-blur">
          <span className="text-sm">
            {ticked.size} of {skills.length} in the library
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={() => setTicked(new Set(skills.map((s) => s.skillId)))}>
            Select all
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setTicked(new Set())}>
            Select none
          </Button>
          <span className="ml-auto text-sm text-muted-foreground">{`Add ${adding}, remove ${removing}`}</span>
          <Button type="submit" size="sm" disabled={pending || adding + removing === 0}>
            {pending ? "Applying" : "Apply"}
          </Button>
        </div>
      </form>
      {state.error && <FieldError>{state.error}</FieldError>}
      {state.report && (
        <p className="text-sm text-muted-foreground">
          {[
            state.report.added.length ? `Added ${state.report.added.join(", ")}.` : "",
            state.report.removed.length ? `Removed ${state.report.removed.join(", ")}.` : "",
            state.report.failed.map((f) => `${f.skillId}: ${f.reason}`).join(" "),
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>Skill</TableHead>
            <TableHead className="text-right">Installs</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
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
        </TableBody>
      </Table>
    </div>
  );
}
