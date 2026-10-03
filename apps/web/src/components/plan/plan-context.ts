"use client";

import { createContext, use, useMemo, useState } from "react";
import type { Forecasts } from "@/lib/plan/forecast";
import type { PlannedSpan } from "@/lib/plan/schedule";
import type { PlanModeName } from "@/lib/project-tab";

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

/**
 * What the size chips need from the Plan page: the project, what each size usually takes in it, the
 * person's hours a day, and where a task's bar sits so a new estimate can say where its Target moves.
 */
export type SizingControl = {
  projectId: string;
  projectName: string;
  /** The project's plan mode: a Flow project has sizes only, with no hours, capacity or manual estimate. */
  mode: PlanModeName;
  forecasts: Forecasts;
  capacity: number;
  spanOf: (issue: number) => PlannedSpan | undefined;
};

/** The size chips' data; without it, rows and cards show no size. */
export const Sizing = createContext<SizingControl | undefined>(undefined);

/**
 * The Flow's tick boxes and Optimize, shared by the toolbar and the Flow (docs/plans/flow.md, Decisions 11 and
 * 13): the epics, stories and tasks the person ticked, and whether Optimize shows its preview. Ticking an item
 * covers what is under it, so `picks` holds only what was ticked.
 */
export type FlowSelectionControl = {
  picks: ReadonlySet<number>;
  setPicks: (picks: ReadonlySet<number>) => void;
  previewing: boolean;
  setPreviewing: (on: boolean) => void;
};

/** The Flow's selection; without it, the Flow shows no tick boxes and the toolbar no Optimize. */
export const FlowSelection = createContext<FlowSelectionControl | undefined>(undefined);
export const useFlowSelection = () => use(FlowSelection);

/** The selection's state, held by the Plan page for its toolbar and its Flow. */
export function useFlowSelectionState(): FlowSelectionControl {
  const [picks, setPicks] = useState<ReadonlySet<number>>(() => new Set());
  const [previewing, setPreviewing] = useState(false);
  return useMemo(() => ({ picks, setPicks, previewing, setPreviewing }), [picks, previewing]);
}
