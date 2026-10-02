import type { Assignee } from "@handoff/github";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/** The first two letters of a login, upper case. */
const initialsOf = (login: string) => login.slice(0, 2).toUpperCase();

/**
 * A person's GitHub avatar with their login as its text. The initials show while it loads, when it
 * fails, and when there is no avatar.
 */
export function PersonAvatar({ person, size = "sm", className, fallbackClassName }: { person: Assignee; size?: "sm" | "default"; className?: string; fallbackClassName?: string }) {
  return (
    <Avatar size={size} className={className}>
      {person.avatarUrl && <AvatarImage src={person.avatarUrl} alt={person.login} />}
      <AvatarFallback className={fallbackClassName}>{initialsOf(person.login)}</AvatarFallback>
    </Avatar>
  );
}
