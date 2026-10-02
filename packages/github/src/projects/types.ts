import type { RepoRef } from "../types.ts";

/** The Status options of a plan's GitHub Project, in board order. */
export const STATUS_OPTIONS = ["Shaping", "Ready", "Running", "In review", "Done"] as const;
export type PlanStatus = (typeof STATUS_OPTIONS)[number];

/** The kinds of issue in a plan, from the top of the hierarchy down. */
export const PLAN_KINDS = ["epic", "story", "task"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

/** An issue of the project's repository that is an item of its GitHub Project. */
export type PlanItem = {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  /** From the kind label, else the issue type, else the depth; undefined when none fits. */
  kind: PlanKind | undefined;
  /** Undefined for a Status option handoff does not know, or no Status at all. */
  status: PlanStatus | undefined;
  /** The parent issue's number. */
  parent: number | undefined;
  labels: string[];
  assignees: string[];
  subIssues: { total: number; completed: number };
  /** The open issues GitHub records as blocking this one. */
  blockedBy: number[];
  /** Pull requests GitHub links to the issue. */
  prNumbers: number[];
  updatedAt: string;
};

export type PlanProject = {
  number: number;
  url: string;
  title: string;
  /** The option id of each Status handoff writes; undefined when the Project has no such option. */
  statusOptions: Record<PlanStatus, string | undefined>;
};

/** One ancestor of an issue, as `lineage` returns it. */
export type PlanAncestor = { number: number; title: string; body: string; kind: PlanKind | undefined };

export type SetStatusResult = "set" | "not-in-project" | "no-option";

/**
 * The plan on a user-owned GitHub Project (v2). OctokitProjects in production, FakeProjects in tests.
 * `project` is a Project number of the repository's owner.
 */
export interface ProjectsPort {
  /** The Project by number for a user; undefined when it does not exist or the token cannot see it. */
  getProject(login: string, number: number): Promise<PlanProject | undefined>;
  /** Every item that is an issue of `repo`, across pages; draft issues, pull requests and other repositories' issues are skipped. */
  listItems(login: string, number: number, repo: RepoRef): Promise<PlanItem[]>;
  /** An issue's Status in the Project, or undefined when it is not an item. */
  getStatus(repo: RepoRef, project: number, issue: number): Promise<PlanStatus | undefined>;
  /** Sets Status; adds the issue to the Project first when `add` is true; returns what it did. */
  setStatus(repo: RepoRef, project: number, issue: number, status: PlanStatus, opts?: { add?: boolean }): Promise<SetStatusResult>;
  /** Creates a user Project with handoff's Status options, linked to the repository. */
  createProject(login: string, repo: RepoRef, title: string): Promise<PlanProject>;
  /** Creates the kind labels epic, story and task on the repository when they are missing. */
  ensureLabels(repo: RepoRef): Promise<void>;
  /** Creates an issue with its labels, parent and blockers, and adds it to the Project in Shaping. */
  createIssue(
    repo: RepoRef,
    input: { project: number; title: string; body: string; labels: string[]; parent?: number; blockedBy?: number[] },
  ): Promise<{ number: number; url: string }>;
  /** The parent and the grandparent of an issue, nearest first, each with title, body and kind. */
  lineage(repo: RepoRef, issue: number): Promise<PlanAncestor[]>;
  /** Whether the token can write Projects: `project` among a classic token's scopes. */
  scopes(): Promise<{ project: boolean; classic: boolean }>;
}
