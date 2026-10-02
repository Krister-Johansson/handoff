"use client";

import { use, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserRoundPlusIcon } from "lucide-react";
import type { PlanTask } from "@/server/plan";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { FieldError } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { taskColumn } from "@/lib/plan/task";
import { cn } from "@/lib/utils";
import { Assigning, type AssignablePerson, type AssignControl } from "./plan-context";

const initials = (login: string) => login.slice(0, 2).toUpperCase();

/** A login's initials in a small circle; mine in the primary colour. */
function Initials({ login, me }: { login: string; me: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("grid size-5 shrink-0 place-items-center rounded-full text-[9px] font-semibold tracking-wide", me ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground")}
    >
      {initials(login)}
    </span>
  );
}

/** The first assignee's initials and how many more there are. */
function Assignees({ logins, me }: { logins: string[]; me: string | undefined }) {
  return (
    <>
      <Initials login={logins[0]!} me={logins[0] === me} />
      {logins.length > 1 && <span className="text-[10px] text-muted-foreground tabular-nums">+{logins.length - 1}</span>}
    </>
  );
}

const nameOf = (task: PlanTask) =>
  task.assignees.length === 0 ? `Assign #${task.number}` : `${task.assignees.length === 1 ? "Assignee" : "Assignees"}: ${task.assignees.join(", ")}. Change`;

/**
 * Who is assigned to a task, on a tree row or a board card: their initials as a button, or a dashed
 * person on an open task with nobody. Without a way to assign, the initials only show who is assigned.
 * A Done task shows an assignee only when it has one.
 */
export function AssigneeButton({ task }: { task: PlanTask }) {
  const control = use(Assigning);
  const assigned = task.assignees;
  if (!control) {
    if (assigned.length === 0) return null;
    return (
      <span title={`Assigned to ${assigned.join(", ")}`} className="inline-flex items-center gap-0.5">
        <Assignees logins={assigned} me={undefined} />
      </span>
    );
  }
  if (assigned.length === 0 && taskColumn(task) === "Done") return null;
  return <AssignPopover task={task} control={control} />;
}

/**
 * The assignee popover: Assign me first, then the people the repository can assign, each adding or
 * removing that person. It writes the issue's assignees on GitHub and leaves the Status as it is.
 */
function AssignPopover({ task, control }: { task: PlanTask; control: AssignControl }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<AssignablePerson[]>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const assigned = task.assignees;
  const isAssigned = new Set(assigned);
  const me = control.me;
  const name = nameOf(task);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    setError(undefined);
    if (next && !people) void control.people().then(setPeople, () => setError("GitHub did not list the people who can be assigned."));
  };
  const change = (logins: string[], withMe?: boolean) =>
    startTransition(async () => {
      const result = await control.assign(task.number, withMe ? { logins, me: true } : { logins });
      if (!result.ok) return setError(result.error);
      setOpen(false);
      router.refresh();
    });
  const toggle = (login: string) => change(isAssigned.has(login)
 ? assigned.filter((a) => a !== login) : [...assigned, login]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={name} className={cn("rounded-full", assigned.length > 1 && "w-auto gap-0.5 px-0.5")}>
          {assigned.length > 0 ? (
            <Assignees logins={assigned} me={me} />
          ) : (
            <span aria-hidden className="grid size-5 place-items-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground">
              <UserRoundPlusIcon className="size-3" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 gap-0 p-0" aria-label={name}>
        <Command>
          <CommandInput placeholder="Find a person" />
          <CommandList>
            <CommandEmpty>{people ? "Nobody matches." : "Loading people"}</CommandEmpty>
            {me && !assigned.includes(me) && (
              <>
                <CommandGroup>
                  <CommandItem value="assign me" disabled={pending} onSelect={() => change(assigned, true)}>
                    <Initials login={me} me />
                    <span className="flex flex-col leading-tight">
                      <span className="font-medium">Assign me</span>
                      <span className="text-xs text-muted-foreground">I will work on this</span>
                    </span>
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            {people && people.length > 0 && (
              <CommandGroup heading="People who can be assigned">
                {people.map((p) => (
                  <CommandItem key={p.login} value={p.login} disabled={pending} data-checked={isAssigned.has(p.login) ? "true" : undefined} onSelect={() => toggle(p.login)}>
                    <Initials login={p.login} me={p.login === me} />
                    <span className="truncate font-mono text-xs">{p.login}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        <div className="flex flex-col gap-1 border-t px-3 py-2">
          {error && <FieldError className="text-xs">{error}</FieldError>}
          <p className="text-xs text-muted-foreground">Assigning does not change the status.</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
