"use client";

import { useState } from "react";
import { CheckIcon, CircleDotIcon, XIcon } from "lucide-react";
import type { IssueSummary } from "@handoff/github";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Plain substring matching on "#number title" and labels. */
const matchIssue = (value: string, search: string, keywords?: string[]) => {
  const needle = search.trim().toLowerCase().replace(/^#/, "");
  return [value, ...(keywords ?? [])].some((text) => text.toLowerCase().replace(/^#/, "").includes(needle)) ? 1 : 0;
};

const label = (issue: Pick<IssueSummary, "number" | "title">) => `#${issue.number} ${issue.title}`;

/** Pick any number of the repository's open issues; each chosen one is submitted as an `issue` field. */
export function IssuePicker({ issues, value, onChange }: { issues: IssueSummary[]; value: IssueSummary[]; onChange: (issues: IssueSummary[]) => void }) {
  const [open, setOpen] = useState(false);
  const chosen = new Set(value.map((i) => i.number));
  const toggle = (issue: IssueSummary) => onChange(chosen.has(issue.number) ? value.filter((i) => i.number !== issue.number) : [...value, issue]);
  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id="run-issues" type="button" variant="outline" role="combobox" aria-expanded={open} aria-label="Issues" className="w-full justify-between font-normal">
            <span className="text-muted-foreground">{value.length ? `${value.length} linked` : "Link issues"}</span>
            <CircleDotIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command filter={matchIssue}>
            <CommandInput placeholder="Search issues" />
            <CommandList>
              <CommandEmpty>{issues.length ? "No issue matches." : "No open issues."}</CommandEmpty>
              <CommandGroup>
                {issues.map((issue) => (
                  <CommandItem key={issue.number} value={label(issue)} keywords={issue.labels} onSelect={() => toggle(issue)}>
                    <CheckIcon className={cn(chosen.has(issue.number) ? "opacity-100" : "opacity-0")} />
                    <span className="font-mono text-xs text-muted-foreground">#{issue.number}</span>{" "}
                    <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <ul aria-label="Linked issues" className="flex flex-col gap-1">
          {value.map((issue) => (
            <li key={issue.number} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
              <input type="hidden" name="issue" value={issue.number} />
              <span className="min-w-0 flex-1 truncate">{label(issue)}</span>
              <Button type="button" size="icon-xs" variant="ghost" aria-label={`Remove #${issue.number}`} onClick={() => toggle(issue)}>
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
