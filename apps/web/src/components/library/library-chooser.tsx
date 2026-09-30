"use client";

import { useState } from "react";
import { LibraryIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LibraryChoices, LibraryEntry as Entry, LibraryKind as Kind, LibrarySelection as Selection } from "@/lib/library-choices";

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

/**
 * A dialog to pick library entries: a tab per kind, a search per tab, checkboxes with descriptions,
 * skills grouped by source. Save hands back the whole selection; the caller stores it.
 */
export function LibraryChooser({
  available,
  initial,
  onSave,
  saving = false,
  title,
  description,
  triggerLabel = "Choose",
}: {
  available: LibraryChoices;
  initial: Selection;
  onSave: (selection: Selection) => Promise<boolean> | boolean;
  saving?: boolean;
  title: string;
  description: string;
  triggerLabel?: string;
}) {
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
        <Button type="button" variant="outline" size="sm">
          <LibraryIcon data-icon="inline-start" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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


/** The chosen entries as small badges, each with a remove button. */
export function ChosenLibrary({ selection, onRemove, disabled = false, empty }: { selection: Selection; onRemove: (kind: Kind, name: string) => void; disabled?: boolean; empty: string }) {
  const chosen = KINDS.flatMap(({ kind, noun }) => selection[kind].map((name) => ({ kind, noun, name })));
  if (chosen.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul aria-label="Chosen library" className="flex flex-wrap gap-1.5">
      {chosen.map((entry) => (
        <li key={`${entry.kind}:${entry.name}`}>
          <Badge variant="secondary" className="gap-1 pr-0.5">
            <span className="text-muted-foreground">{entry.noun}</span>
            <span className="font-mono">{entry.name}</span>
            <Button type="button" size="icon-xs" variant="ghost" disabled={disabled} aria-label={`Remove ${entry.noun} ${entry.name}`} onClick={() => onRemove(entry.kind, entry.name)}>
              <XIcon />
            </Button>
          </Badge>
        </li>
      ))}
    </ul>
  );
}
