"use client";

import { useState } from "react";
import { passEnvProblem } from "@handoff/core";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** Names of worker environment variables a command gets. The graph stores names, never values. */
export function PassEnvField({
  id,
  value,
  onChange,
  description = "Passed from the worker's environment. The command gets PATH, HOME, locale and CI=true plus these.",
}: {
  id: string;
  value: string[];
  onChange: (names: string[]) => void;
  description?: string;
}) {
  const [problem, setProblem] = useState<string>();
  return (
    <Field data-invalid={problem ? true : undefined}>
      <FieldLabel htmlFor={id}>Environment variables</FieldLabel>
      <Input
        id={id}
        className="font-mono text-xs"
        placeholder="APP_TEST_DB FEATURE_X"
        defaultValue={value.join(" ")}
        aria-invalid={problem ? true : undefined}
        onBlur={(e) => {
          const names = e.target.value.split(/[\s,]+/).filter(Boolean);
          const found = passEnvProblem(names);
          setProblem(found);
          if (!found) onChange(names);
        }}
      />
      <FieldDescription>{description}</FieldDescription>
      {problem && <FieldError>{problem}</FieldError>}
    </Field>
  );
}
