"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ChevronDownIcon, UserPlusIcon, XIcon } from "lucide-react";
import { assignableAction, assignAction } from "@/app/projects/issue-actions";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { Assignee } from "@handoff/github";
import { PersonAvatar } from "@/components/person-avatar";
import type { AssignableUser } from "@/server/assignees";

type Props = {
  projectId: string;
  issue: number;
  assignees: Assignee[];
  /** The token's user ("you"); undefined with a GitHub App. */
  viewer: string | undefined;
  /** Offer Assign me, "I will work on this", as on tasks and issues outside the plan. */
  assignMe: boolean;
};

/**
 * Who is assigned the issue, as one button that opens a picker of the people the repository can
 * assign, and Assign me beside it on the issues a run works on. A change is written to GitHub at once;
 * the Status stays.
 */
export function Assignees({ projectId, issue, assignees: initial, viewer, assignMe }: Props) {
  const router = useRouter();
  const [assignees, setAssignees] = useState(initial);
  const [people, setPeople] = useState<{ repo: string; users: AssignableUser[] } | { error: string }>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [, startLoading] = useTransition();
  const write = (logins: string[], me = false) =>
    startTransition(async () => {
      setError(undefined);
      const result = await assignAction({ projectId, issue, logins, ...(me ? { me } : {}) });
      if (!result.ok) return setError(result.error);
      setAssignees(result.assignees);
      router.refresh();
    });
  const load = (open: boolean) => {
    if (open && !people) startLoading(async () => setPeople(await assignableAction(projectId)));
  };
  const logins = assignees.map((a) => a.login);
  const assigned = new Set(logins);
  const toggle = (login: string) => write(assigned.has(login) ? logins.filter((a) => a !== login) : [...logins, login]);
  const name = logins.length ? `Assignee${logins.length > 1 ? "s" : ""}: ${logins.join(", ")}. Change assignees` : "No assignee. Change assignees";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Popover onOpenChange={load}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="xs" aria-label={name} className={cn("font-normal", assignees.length === 0 && "border-dashed text-muted-foreground")}>
            {assignees.length === 0 ? (
              <>
                <UserPlusIcon data-icon="inline-start" />
                No assignee
              </>
            ) : (
              assignees.map((person) => (
                <span key={person.login} className="inline-flex items-center gap-1.5">
                  <PersonAvatar person={person} />
                  {person.login}
                </span>
              ))
            )}
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0" aria-label={`Assignees of #${issue}`}>
          <Command>
            <CommandInput placeholder="Filter people" />
            <CommandList>
              {!people ? (
                <div className="flex items-center gap-2 px-3 py-3 text-[13px] text-muted-foreground">
                  <Spinner role="presentation" aria-label={undefined} aria-hidden /> Reading who can be assigned
                </div>
              ) : "error" in people ? (
                <p className="px-3 py-3 text-[13px] text-muted-foreground">{people.error}</p>
              ) : (
                <>
                  <CommandEmpty>Nobody matches.</CommandEmpty>
                  <CommandGroup>
                    {people.users.map((user) => (
                      <CommandItem key={user.login} value={user.login} disabled={pending} onSelect={() => toggle(user.login)} data-checked={assigned.has(user.login) || undefined}>
                        <PersonAvatar person={user} />
                        <span className="min-w-0 flex-1 truncate">{user.login}</span>
                        {user.you && <span className="text-xs text-muted-foreground">you</span>}
                        {assigned.has(user.login) && <CheckIcon aria-label="Assigned" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {assignees.length > 0 && (
                    <>
                      <CommandSeparator />
                      <CommandGroup>
                        <CommandItem value="clear assignees" disabled={pending} onSelect={() => write([])}>
                          <XIcon />
                          Clear assignees
                        </CommandItem>
                      </CommandGroup>
                    </>
                  )}
                </>
              )}
            </CommandList>
            {people && "repo" in people && <p className="border-t px-3 py-2 text-xs text-muted-foreground">People who can be assigned in {people.repo}</p>}
          </Command>
        </PopoverContent>
      </Popover>
      {assignMe && viewer && !assigned.has(viewer) && (
        <Button variant="ghost" size="xs" disabled={pending} onClick={() => write(logins, true)}>
          Assign me
        </Button>
      )}
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
