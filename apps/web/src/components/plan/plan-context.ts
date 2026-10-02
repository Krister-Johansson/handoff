"use client";

import { createContext, use } from "react";

/** The Plan page's search text, for the titles that mark what it found and the rows that say they match. */
export const SearchQuery = createContext("");
export const useSearchQuery = () => use(SearchQuery);

/** A person who can be assigned issues in the project's repository, with their GitHub avatar. */
export type AssignablePerson = { login: string; avatarUrl: string };

/**
 * What the assignee control needs from the server: who "me" is, the people the repository can assign,
 * and a way to set an issue's assignees on GitHub. Assigning never changes the plan's Status.
 */
export type AssignControl = {
  /** The login of the token handoff uses; undefined with a GitHub App, which acts as no person. */
  me: string | undefined;
  people: () => Promise<AssignablePerson[]>;
  /** Replaces the issue's assignees with `logins`, plus the token's user with `me`. */
  assign: (issue: number, change: { logins: string[]; me?: boolean }) => Promise<{ ok: true } | { ok: false; error: string }>;
};

/** The assignee control's server side; without one, rows and cards only show who is assigned. */
export const Assigning = createContext<AssignControl | undefined>(undefined);
