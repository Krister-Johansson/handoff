"use client";

import { useState, useTransition } from "react";
import { XIcon } from "lucide-react";
import { saveProjectLibraryAction } from "@/app/projects/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Kind = "groups" | "skills" | "mcp" | "agents";
type Selection = Record<Kind, string[]>;
/** `source` groups skills under the repository they came from. */
type Entry = { name: string; detail: string; source?: string };

const KINDS: { kind: Kind; heading: string; noun: string }[] = [
  { kind: "groups", heading: "Groups", noun: "group" },
  { kind: "skills", heading: "Skills", noun: "skill" },
  { kind: "mcp", heading: "MCP servers", noun: "MCP server" },
  { kind: "agents", heading: "Agents", noun: "agent" },
];

const matches = (entry: Entry, search: string) => {
  const needle = search.trim().toLowerCase();
  return !needle || entry.name.toLowerCase().includes(needle) || entry.detail.toLowerCase().includes(needle);
};

/** Entries under their source, in the order the sources first appear. */
function bySource(entries: Entry[]) {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) groups.set(entry.source ?? "", [...(groups.get(entry.source ?? "") ?? []), entry]);
  return [...groups.entries()];
}

function EntryList({ kind, heading, entries, chosen, onToggle }: { kind: Kind; heading: string; entries: Entry[]; chosen: Set<string>; onToggle: (name: string) => void }) {
  const [search, setSearch] = useState("");
  const shown = entries.filter((e) => matches(e, search));
  return (
    <div className="flex flex-col gap-3">
      <Input type="search" aria-label={`Search ${heading.toLowerCase()}`} placeholder={`Search ${heading.toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="max-h-[50vh] overflow-y-auto pr-1">
        {entries.length === 0 && <p className="text-sm text-muted-foreground">None in the library yet.</p>}
        {entries.length > 0 && shown.length === 0 && <p className="text-sm text-muted-foreground">Nothing matches.</p>}
        {bySource(shown).map(([source, list]) => (
          <section key={source} className="flex flex-col">
            {source && <h3 className="sticky top-0 bg-background py-1 font-mono text-xs text-muted-foreground">{source}</h3>}
            <ul className="flex flex-col divide-y">
              {list.map((entry) => (
                <li key={entry.name} className="flex items-start gap-3 py-2">
                  <Checkbox id={`default-${kind}-${entry.name}`} aria-label={entry.name} checked={chosen.has(entry.name)} onCheckedChange={() => onToggle(entry.name)} className="mt-0.5" />
                  <label htmlFor={`default-${kind}-${entry.name}`} className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-mono text-sm">{entry.name}</span>
                    {entry.detail && <span className="line-clamp-2 text-xs text-muted-foreground">{entry.detail}</span>}
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function ChooseDialog({ available, initial, onSave, saving }: { available: Record<Kind, Entry[]>; initial: Selection; onSave: (selection: Selection) => Promise<boolean>; saving: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(initial);
  const toggle = (kind: Kind, name: string) => setDraft((d) => ({ ...d, [kind]: d[kind].includes(name) ? d[kind].filter((n) => n !== name) : [...d[kind], name] }));
  const count = KINDS.reduce((n, { kind }) => n + draft[kind].length, 0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Every opening starts from what is saved.
        if (next) setDraft(initial);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          Choose
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Default library</DialogTitle>
          <DialogDescription>Every planner, coder and reviewer in this project&apos;s runs gets what you tick here.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="skills" className="min-w-0">
          <TabsList className="max-w-full justify-start overflow-x-auto">
            {KINDS.map(({ kind, heading }) => (
              <TabsTrigger key={kind} value={kind}>
                {heading}
                {draft[kind].length > 0 && <Badge variant="secondary">{draft[kind].length}</Badge>}
              </TabsTrigger>
            ))}
          </TabsList>
          {KINDS.map(({ kind, heading }) => (
            <TabsContent key={kind} value={kind}>
              <EntryList kind={kind} heading={heading} entries={available[kind]} chosen={new Set(draft[kind])} onToggle={(name) => toggle(kind, name)} />
            </TabsContent>
          ))}
        </Tabs>
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">{count} chosen</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={async () => (await onSave(draft)) && setOpen(false)}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Library entries every CLI node of every run in the project gets, on top of what each node enables
 * itself. Only names are stored; MCP secrets and OAuth tokens stay with the worker. The page keys this
 * component on the saved selection, so `initial` is what is saved.
 */
export function DefaultLibrary({ projectId, available, initial }: { projectId: string; available: Record<Kind, Entry[]>; initial: Selection }) {
  const [error, setError] = useState<string>();
  const [saving, startSaving] = useTransition();
  const save = (selection: Selection) =>
    new Promise<boolean>((resolve) =>
      startSaving(async () => {
        const result = await saveProjectLibraryAction(projectId, selection);
        setError("error" in result ? result.error : undefined);
        resolve(!("error" in result));
      }),
    );
  const chosen = KINDS.flatMap(({ kind, noun }) => initial[kind].map((name) => ({ kind, noun, name })));
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
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  disabled={saving}
                  aria-label={`Remove ${entry.noun} ${entry.name}`}
                  onClick={() => void save({ ...initial, [entry.kind]: initial[entry.kind].filter((n) => n !== entry.name) })}
                >
                  <XIcon />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {error && <FieldError>{error}</FieldError>}
      <div>
        <ChooseDialog available={available} initial={initial} onSave={save} saving={saving} />
      </div>
    </div>
  );
}
