"use client";

import { useState, useTransition } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { missingFields, type PlanFieldsPresent } from "@/lib/plan/plan-fields";
import type { PlanModeName } from "@/lib/project-tab";
import { addMissingFields } from "./add-missing-fields";

/**
 * The Add the fields button with the refusal under it, for a Project that lacks fields the plan mode reads;
 * nothing when it lacks none. `picked` is a mode picked in Plan mode and not saved yet.
 */
export function AddFieldsButton({ projectId, mode, fields, picked = false }: { projectId: string; mode: PlanModeName; fields: PlanFieldsPresent; picked?: boolean }) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  if (missingFields(fields, mode).length === 0) return null;
  const add = () =>
    startTransition(async () => {
      setError((await addMissingFields(projectId, mode, fields, picked)).error);
    });
  return (
    <>
      <Button size="xs" variant="outline" disabled={pending} onClick={add}>
        <PlusIcon data-icon="inline-start" />
        Add the fields
      </Button>
      {error && <FieldError>{error}</FieldError>}
    </>
  );
}
