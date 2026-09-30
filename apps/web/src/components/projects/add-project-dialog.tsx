"use client";

import { useActionState, useState, useTransition } from "react";
import { CheckIcon, ChevronsUpDownIcon, LockIcon, PlusIcon } from "lucide-react";
import { createProjectAction, listReposAction, type ActionState } from "@/app/projects/actions";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { suggestProjectName } from "@/lib/project-name";
import { cn } from "@/lib/utils";
import type { AvailableRepo } from "@/server/repos";

/** Plain substring matching on the repository name and description; cmdk's fuzzy default matches too much. */
const matchRepo = (value: string, search: string, keywords?: string[]) => {
  const needle = search.trim().toLowerCase();
  return [value, ...(keywords ?? [])].some((text) => text.toLowerCase().includes(needle)) ? 1 : 0;
};

type Loaded = { repos: AvailableRepo[] } | { error: string };

function RepoPicker({ repos, value, onChange }: { repos: AvailableRepo[]; value: AvailableRepo | undefined; onChange: (repo: AvailableRepo) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id="project-repo" variant="outline" role="combobox" aria-expanded={open} aria-label="GitHub repository" className="w-full justify-between font-normal">
          <span className={cn("truncate font-mono text-xs", !value && "font-sans text-sm text-muted-foreground")}>{value?.fullName ?? "Choose a repository"}</span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command filter={matchRepo}>
          <CommandInput placeholder="Search repositories" />
          <CommandList>
            <CommandEmpty>No repository matches.</CommandEmpty>
            <CommandGroup>
              {repos.map((repo) => (
                <CommandItem
                  key={repo.id}
                  value={repo.fullName}
                  keywords={repo.description ? [repo.description] : []}
                  disabled={repo.project !== null}
                  onSelect={() => {
                    onChange(repo);
                    setOpen(false);
                  }}
                >
                  <CheckIcon className={cn(value?.id === repo.id ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{repo.fullName}</span>
                  {repo.private && <LockIcon aria-label="private" className="text-muted-foreground" />}
                  {repo.project !== null && <span className="text-xs text-muted-foreground">{repo.project}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Add project button and dialog: pick a repository from GitHub, or type owner/name without GitHub access. */
export function AddProjectDialog() {
  const [state, action, pending] = useActionState(createProjectAction, {} as ActionState);
  const [loaded, setLoaded] = useState<Loaded>();
  const [loading, startLoading] = useTransition();
  const [repo, setRepo] = useState<AvailableRepo>();
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");

  const onOpenChange = (open: boolean) => {
    if (open && !loaded) startLoading(async () => setLoaded(await listReposAction()));
  };
  const choose = (next: AvailableRepo) => {
    setRepo(next);
    setName(suggestProjectName(next.name, []));
    setBranch(next.defaultBranch);
  };

  return (
    <Dialog onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon data-icon="inline-start" />
          Add project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>Add a project</DialogTitle>
            <DialogDescription>The worker clones the repository and opens pull requests there.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="project-repo">GitHub repository</FieldLabel>
              {loading || !loaded ? (
                <Skeleton className="h-9 w-full" />
              ) : "repos" in loaded ? (
                <>
                  <RepoPicker repos={loaded.repos} value={repo} onChange={choose} />
                  <input type="hidden" name="repo" value={repo?.fullName ?? ""} />
                </>
              ) : (
                <>
                  <Input id="project-repo" name="repo" placeholder="owner/name" defaultValue={state.values?.repo} />
                  <FieldDescription>{loaded.error}</FieldDescription>
                </>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="project-name">Name</FieldLabel>
              <Input id="project-name" name="name" placeholder="sandbox" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-branch">Default branch</FieldLabel>
              <Input id="project-branch" name="defaultBranch" placeholder="main" value={branch} onChange={(e) => setBranch(e.target.value)} />
            </Field>
            {state.error && <FieldError>{state.error}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Add project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
