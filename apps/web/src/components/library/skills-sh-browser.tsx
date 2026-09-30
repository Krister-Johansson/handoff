"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { DownloadIcon, SearchIcon } from "lucide-react";
import { importSkillAction, searchSkillsShAction, type ImportState, type SkillsShHit } from "@/app/library/skills-sh-actions";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const installs = new Intl.NumberFormat("en", { notation: "compact" });

function ImportButton({ hit }: { hit: SkillsShHit }) {
  const [state, action, pending] = useActionState(importSkillAction, {} as ImportState);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={hit.id} />
      {state.error && <FieldError className="max-w-64 text-xs">{state.error}</FieldError>}
      <Button type="submit" size="sm" variant="outline" disabled={pending} aria-label={`Import ${hit.name}`}>
        <DownloadIcon data-icon="inline-start" />
        {pending ? "Importing" : "Import"}
      </Button>
    </form>
  );
}

/** Search skills.sh and import a skill, with all its files, into the library. */
export function SkillsShBrowser() {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Awaited<ReturnType<typeof searchSkillsShAction>>>();
  const [searching, startSearch] = useTransition();
  const search = () => startSearch(async () => setFound(await searchSkillsShAction(query)));
  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <Input aria-label="Search skills.sh" placeholder="tdd, react, postgres, code review..." value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-md" />
        <Button type="submit" disabled={searching || !query.trim()}>
          <SearchIcon data-icon="inline-start" />
          Search
        </Button>
      </form>
      {searching && <Skeleton className="h-40 w-full" />}
      {!searching && found && "error" in found && <FieldError>{found.error}</FieldError>}
      {!searching && found && "results" in found && found.results.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No skills found</EmptyTitle>
            <EmptyDescription>Try another word.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {!searching && found && "results" in found && found.results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {found.results.map((hit) => (
            <li key={hit.id} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <a href={`https://skills.sh/${hit.id}`} className="truncate font-mono text-sm hover:underline">
                  {hit.name}
                </a>
                <span className="flex gap-3 text-xs text-muted-foreground">
                  <span>{hit.source}</span>
                  <span>{installs.format(hit.installs)} installs</span>
                </span>
              </div>
              {hit.inLibrary ? (
                <Button size="sm" variant="secondary" asChild>
                  <Link href={`/library/skills/${hit.inLibrary}`}>In library</Link>
                </Button>
              ) : (
                <ImportButton hit={hit} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
