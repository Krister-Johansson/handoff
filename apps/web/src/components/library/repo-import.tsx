"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { FolderGitIcon } from "lucide-react";
import { suggestProjectName } from "@handoff/core";
import { importRepoAction, type RepoImportState } from "@/app/library/repo-import-actions";
import { StatusBadge } from "@/components/runs/status-badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const STATUS_TONE = { imported: "succeeded", updated: "succeeded", unchanged: "queued", skipped: "cancelled" } as const;

/** Imports every skill in a GitHub repository (folders with a SKILL.md) and groups them under one name. */
export function RepoImport() {
  const [state, action, pending] = useActionState(importRepoAction, {} as RepoImportState);
  const [repo, setRepo] = useState("");
  const [owner, name] = repo.trim().split("/");
  const suggested = owner && name ? suggestProjectName(`${owner}-${name}`, []) : "owner-repo";
  const report = state.report;
  const counts = report
    ? Object.entries(Object.groupBy(report.skills, (s) => s.status))
        .map(([status, list]) => `${list?.length ?? 0} ${status}`)
        .join(", ")
    : "";
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <Field className="w-72">
          <FieldLabel htmlFor="repo-import-repo">Repository</FieldLabel>
          <Input id="repo-import-repo" name="repo" placeholder="anthropics/skills" value={repo} onChange={(e) => setRepo(e.target.value)} className="font-mono" />
        </Field>
        <Field className="w-56">
          <FieldLabel htmlFor="repo-import-group">Group</FieldLabel>
          <Input id="repo-import-group" name="group" placeholder={suggested} className="font-mono" />
        </Field>
        <Button type="submit" disabled={pending || !repo.trim()}>
          <FolderGitIcon data-icon="inline-start" />
          {pending ? "Importing" : "Import repository"}
        </Button>
      </form>
      <FieldDescription>
        Every folder with a SKILL.md becomes a skill, with all its files. Importing again updates only the skills that changed; skills already in the library from elsewhere are left alone.
      </FieldDescription>
      {state.error && <FieldError>{state.error}</FieldError>}
      {report && (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-sm">
            Group{" "}
            <Link href={`/library/groups/${report.group}`} className="font-mono font-medium hover:underline">
              {report.group}
            </Link>
            : <span>{counts}</span>
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {report.skills.map((s) => (
              <li key={s.path} className="flex items-center gap-2">
                <StatusBadge status={STATUS_TONE[s.status]} label={s.status} />
                {s.status === "skipped" ? (
                  <span className="font-mono">{s.name}</span>
                ) : (
                  <Link href={`/library/skills/${s.name}`} className="font-mono hover:underline">
                    {s.name}
                  </Link>
                )}
                <span className="truncate text-xs text-muted-foreground">{"reason" in s ? s.reason : s.path}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
