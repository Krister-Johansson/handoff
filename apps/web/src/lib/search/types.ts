import type { PlanKind, PlanStatus } from "@handoff/github";
import type { PlanModeName } from "../project-tab";

/** A project as search knows it; `current` marks the project search covers. */
export type SearchProject = { id: string; name: string; repo: string; planMode: PlanModeName; current: boolean };

/** A run: its short id, a title from its first issue or its task, the issue numbers, branch and status. `at` is null in a Flow project, which shows no dates. */
export type SearchRun = {
  id: string;
  shortId: string;
  projectId: string;
  title: string;
  issues: number[];
  status: string;
  branch: string;
  prNumber: number | null;
  /** When the run was created, ISO; null in a Flow project. */
  at: string | null;
};

/** An assistant chat, matched by title. `at` (last use, ISO) is null in a Flow project. */
export type SearchChat = { id: string; title: string; projectId: string | null; pinned: boolean; at: string | null };

/**
 * A task of the plan, or an open issue of a project without a plan, or an issue a run linked when GitHub
 * did not answer. Plan items carry kind, status, state and parent; the fallbacks carry none of them, and
 * `fromRun` names the short id of the latest run that linked the issue.
 */
export type SearchTask = {
  projectId: string;
  number: number;
  title: string;
  kind?: PlanKind;
  status?: PlanStatus;
  state?: "open" | "closed";
  parent?: { number: number; title: string; kind?: PlanKind };
  fromRun?: string;
};

/**
 * Where a project's tasks came from: the plan on GitHub Projects, the open issues of a project without a
 * plan, or the runs' issues when GitHub failed, with what GitHub said.
 */
export type TaskSource = { projectId: string; repo: string; source: "plan" | "issues" | "runs"; error?: string };

/** What Postgres answers at once: the projects, the latest runs of each and the chats. */
export type SearchRecords = { projectId: string | null; projects: SearchProject[]; runs: SearchRun[]; chats: SearchChat[] };

/** What GitHub answers, cached per project: the tasks and where each project's tasks came from. */
export type SearchTasks = { tasks: SearchTask[]; sources: TaskSource[] };
