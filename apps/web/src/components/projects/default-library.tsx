"use client";

import { useState, useTransition } from "react";
import { saveProjectLibraryAction } from "@/app/projects/actions";
import { ChosenLibrary, LibraryChooser } from "@/components/library/library-chooser";
import { FieldError } from "@/components/ui/field";
import type { LibraryChoices, LibrarySelection as Selection } from "@/lib/library-choices";
import { cn } from "@/lib/utils";
import { CARD_BODY, SectionCard } from "@/components/section-card";

/**
 * Library entries every CLI node of every run in the project gets, on top of what each node enables
 * itself. Only names are stored; MCP secrets and OAuth tokens stay with the worker. The page keys this
 * component on the saved selection, so `initial` is what is saved.
 */
export function DefaultLibrary({ projectId, available, initial }: { projectId: string; available: LibraryChoices; initial: Selection }) {
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
  return (
    <SectionCard
      title="Default library"
      description="Every planner, coder and reviewer in this project's runs gets these, on top of what each node enables."
      action={
        <LibraryChooser
          available={available}
          initial={initial}
          onSave={save}
          saving={saving}
          title="Default library"
          description="Every planner, coder and reviewer in this project's runs gets what you tick here."
        />
      }
    >
      <div className={cn(CARD_BODY, "flex flex-col gap-3")}>
        <ChosenLibrary
          selection={initial}
          disabled={saving}
          empty="No default yet: runs get only what each node enables."
          onRemove={(kind, name) => void save({ ...initial, [kind]: initial[kind].filter((n) => n !== name) })}
        />
        {error && <FieldError>{error}</FieldError>}
      </div>
    </SectionCard>
  );
}
