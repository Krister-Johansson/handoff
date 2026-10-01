"use client";

import Link from "next/link";
import { useActionState, useState, useTransition, type ReactNode } from "react";
import { CheckIcon, DownloadIcon, SearchIcon } from "lucide-react";
import { importSkillAction, searchSkillsShAction, type ImportState, type SkillsShHit } from "@/app/library/skills-sh-actions";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { FieldError } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchField } from "./search-field";
import { Tag } from "./tag";

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

/**
 * Search skills.sh and import a skill, with all its files, into the library. `lead` sits before the
 * search on the same line, such as the field that opens an owner or repository.
 */
export function SkillsShBrowser({ lead }: { lead?: ReactNode }) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [found, setFound] = useState<Awaited<ReturnType<typeof searchSkillsShAction>>>();
  const [searching, startSearch] = useTransition();
  const search = () =>
    startSearch(async () => {
      setFound(await searchSkillsShAction(query));
      setSearched(query.trim());
    });
  const results = !searching && found && "results" in found ? found.results : undefined;
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
        {lead && (
          <>
            {lead}
            <span className="px-1 text-[13px] text-muted-foreground/70">or</span>
          </>
        )}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <SearchField aria-label="Search skills.sh" placeholder="tdd, react, postgres, code review..." value={query} onChange={(e) => setQuery(e.target.value)} className="w-72 max-w-full" />
          <Button type="submit" disabled={searching || !query.trim()}>
            <SearchIcon data-icon="inline-start" />
            Search
          </Button>
        </form>
      </div>
      {searching && <Skeleton className="mx-5 mb-4 h-40" />}
      {!searching && found && "error" in found && <FieldError className="px-5 pb-4">{found.error}</FieldError>}
      {results && results.length === 0 && (
        <Empty className="border-t">
          <EmptyHeader>
            <EmptyTitle>No skills found</EmptyTitle>
            <EmptyDescription>Try another word.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {results && results.length > 0 && (
        <>
          <p className="flex items-center gap-2 border-t px-5 py-2.5 text-[13px]">
            <span className="text-muted-foreground">
              {results.length} {results.length === 1 ? "result" : "results"} for
            </span>
            <Tag fill>{searched}</Tag>
          </p>
          <ul className="flex flex-col">
            {results.map((hit) => (
              <li key={hit.id} className="flex items-center gap-3 border-t px-5 py-2.5 hover:bg-muted/50">
                <div className="flex min-w-0 flex-1 flex-col">
                  <a href={`https://skills.sh/${hit.id}`} className="truncate font-mono text-[13px] hover:underline hover:underline-offset-3">
                    {hit.name}
                  </a>
                  <span className="flex gap-2.5 text-xs text-muted-foreground">
                    <Link href={`/library/skills-sh/${hit.source}`} className="hover:underline hover:underline-offset-3">
                      {hit.source}
                    </Link>
                  </span>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">{installs.format(hit.installs)} installs</span>
                {hit.inLibrary ? (
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/library/skills/${hit.inLibrary}`}>
                      <CheckIcon data-icon="inline-start" />
                      In library
                    </Link>
                  </Button>
                ) : (
                  <ImportButton hit={hit} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
