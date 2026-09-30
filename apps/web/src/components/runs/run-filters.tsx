"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RUN_STATUS_FILTERS, runFilterHref, type RunFilter } from "@/lib/run-filter";

/** Status links and a project picker for the runs list; the filter lives in the URL. */
export function RunFilters({ filter, projects }: { filter: RunFilter; projects: string[] }) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Status" className="flex flex-wrap gap-1">
        {RUN_STATUS_FILTERS.map((s) => {
          const current = filter.status === s.value;
          return (
            <Button key={s.label} asChild size="sm" variant={current ? "secondary" : "ghost"}>
              <Link href={runFilterHref(filter, { status: s.value })} aria-current={current ? "page" : undefined}>
                {s.label}
              </Link>
            </Button>
          );
        })}
      </nav>
      <div className="flex items-center gap-2">
        <Label htmlFor="runs-project" className="text-muted-foreground">
          Project
        </Label>
        <NativeSelect
          id="runs-project"
          size="sm"
          value={filter.project ?? ""}
          onChange={(e) => router.push(runFilterHref(filter, { project: e.target.value || undefined }))}
        >
          <NativeSelectOption value="">All projects</NativeSelectOption>
          {projects.map((name) => (
            <NativeSelectOption key={name} value={name}>
              {name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}
