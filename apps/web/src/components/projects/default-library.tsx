"use client";

import { useState, useTransition } from "react";
import { CheckIcon, LibraryIcon, XIcon } from "lucide-react";
import { saveProjectLibraryAction } from "@/app/projects/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { FieldError } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Kind = "groups" | "skills" | "mcp" | "agents";
type Selection = Record<Kind, string[]>;
type Entry = { name: string; detail: string };

const KINDS: { kind: Kind; heading: string; noun: string }[] = [
  { kind: "groups", heading: "Groups", noun: "group" },
  { kind: "skills", heading: "Skills", noun: "skill" },
  { kind: "mcp", heading: "MCP servers", noun: "MCP server" },
  { kind: "agents", heading: "Agents", noun: "agent" },
];

const sameSelection = (a: Selection, b: Selection) => KINDS.every(({ kind }) => a[kind].join("\n") === b[kind].join("\n"));

function LibraryCombobox({ available, value, onToggle }: { available: Record<Kind, Entry[]>; value: Selection; onToggle: (kind: Kind, name: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} aria-label="Add from the library" className="w-72 justify-between font-normal">
          <span className="text-muted-foreground">Add from the library</span>
          <LibraryIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search skills, MCP servers, agents, groups" />
          <CommandList>
            <CommandEmpty>Nothing in the library matches.</CommandEmpty>
            {KINDS.filter(({ kind }) => available[kind].length > 0).map(({ kind, heading }) => (
              <CommandGroup key={kind} heading={heading}>
                {available[kind].map((entry) => (
                  <CommandItem key={entry.name} value={`${kind}:${entry.name}`} keywords={[entry.name, entry.detail]} onSelect={() => onToggle(kind, entry.name)}>
                    <CheckIcon className={cn(value[kind].includes(entry.name) ? "opacity-100" : "opacity-0")} />
                    <span className="font-mono text-xs">{entry.name}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{entry.detail}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Library entries every CLI node of every run in the project gets, on top of what each node enables
 * itself. Only names are stored; MCP secrets and OAuth tokens stay with the worker.
 */
export function DefaultLibrary({ projectId, available, initial }: { projectId: string; available: Record<Kind, Entry[]>; initial: Selection }) {
  // The page revalidates after a save and keys this component on the saved selection, so `initial` is what is saved.
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string>();
  const [saving, startSaving] = useTransition();
  const toggle = (kind: Kind, name: string) =>
    setDraft((d) => ({ ...d, [kind]: d[kind].includes(name) ? d[kind].filter((n) => n !== name) : [...d[kind], name] }));
  const chosen = KINDS.flatMap(({ kind, noun }) => draft[kind].map((name) => ({ kind, noun, name })));
  const save = () =>
    startSaving(async () => {
      const result = await saveProjectLibraryAction(projectId, draft);
      if ("error" in result) return setError(result.error);
      setError(undefined);
    });
  return (
    <div className="flex flex-col gap-3">
      {chosen.length === 0 ? (
        <p className="text-sm text-muted-foreground">No default yet: runs get only what each node enables.</p>
      ) : (
        <ul aria-label="Default library" className="flex flex-wrap gap-2">
          {chosen.map((entry) => (
            <li key={`${entry.kind}:${entry.name}`}>
              <Badge variant="secondary" className="gap-1 pr-0.5">
                <span className="text-muted-foreground">{entry.noun}</span>
                <span className="font-mono">{entry.name}</span>
                <Button type="button" size="icon-xs" variant="ghost" aria-label={`Remove ${entry.noun} ${entry.name}`} onClick={() => toggle(entry.kind, entry.name)}>
                  <XIcon />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {error && <FieldError>{error}</FieldError>}
      <div className="flex flex-wrap gap-2">
        <LibraryCombobox available={available} value={draft} onToggle={toggle} />
        <Button type="button" disabled={saving || sameSelection(draft, initial)} onClick={save}>
          Save default library
        </Button>
      </div>
    </div>
  );
}
