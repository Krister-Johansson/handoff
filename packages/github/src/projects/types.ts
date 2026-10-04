import type { Assignee, RepoRef } from "../types.ts";
import type { PLAN_KINDS, PLAN_SIZES, STATUS_OPTIONS } from "./kinds.ts";

export type PlanStatus = (typeof STATUS_OPTIONS)[number];
export type PlanKind = (typeof PLAN_KINDS)[number];
/** handoff's sizes, the options S, M and L of the Project's single select field named Size. */
export type PlanSize = (typeof PLAN_SIZES)[number];

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
  assignees: Assignee[];
  subIssues: { total: number; completed: number };
  /** The open issues GitHub records as blocking this one. */
  blockedBy: number[];
  /** Pull requests GitHub links to the issue. */
  prNumbers: number[];
  updatedAt: string;
  /*
   * The fields below are optional so plan items built by hand (in tests and fixtures) need not name
   * them; the readers always set them.
   */
  /** Every issue GitHub records as blocking this one, open or closed; `blockedBy` is the open ones. */
  blockers?: number[] | undefined;
  /**
   * The item's place in Project order, 1 for the first item. Every item of the Project counts, so drafts,
   * pull requests and other repositories' issues leave gaps.
   */
  position?: number | undefined;
  /** The option name of the Project's single select field named Priority; undefined without a value or such a field. */
  priority?: string | undefined;
  /** YYYY-MM-DD from the Project's Start date field. */
  start?: string | undefined;
  /** YYYY-MM-DD from the Project's Target date field. */
  target?: string | undefined;
  /** The item's iteration, when the Project has an iteration field named Iteration; read only. */
  iteration?: PlanIteration | undefined;
  /** S, M or L from the Size field; undefined without a value, without the field, or for another option. */
  size?: PlanSize | undefined;
  /** Hours from the Estimate number field; undefined without a value, without the field, or at 0 or less. */
  estimate?: number | undefined;
  /** The item's node id in the Project, for order writes. */
  itemId?: string | undefined;
};

/** One move in Project order: the item goes right after `afterId`, or to the top for null. */
export type ItemMove = { itemId: string; afterId: string | null };

/** An iteration of a Project's iteration field: its title, first day (YYYY-MM-DD) and length in days. */
export type PlanIteration = { title: string; startDate: string; duration: number };

export type PlanProject = {
  number: number;
  url: string;
  title: string;
  /** Whether a user or an organization owns the Project. Optional like `dateFields`. */
  owner?: "User" | "Organization" | undefined;
  /** The option id of each Status handoff writes; undefined when the Project has no such option. */
  statusOptions: Record<PlanStatus, string | undefined>;
  /**
   * The ids of the Start and Target date fields, each undefined while the Project lacks it. Optional so
   * Projects built by hand need not name it; the readers always set it.
   */
  dateFields?: PlanDateFieldIds | undefined;
  /**
   * The option names of the single select field named Priority in the field's order, the highest first;
   * undefined when the Project has no such field. Optional like `dateFields`.
   */
  priorityOptions?: string[] | undefined;
  /** The Size and Estimate field ids, each undefined while the Project lacks it. Optional like `dateFields`. */
  estimateFields?: PlanEstimateFieldIds | undefined;
};

/** The field ids of a Project's Start and Target date fields; undefined for one it lacks. */
export type PlanDateFieldIds = { start: string | undefined; target: string | undefined };

/**
 * The Size single select field's id with the ids of its S, M and L options (undefined for one it lacks),
 * and the Estimate number field's id. Each field is undefined while the Project lacks it or has a field
 * of that name of another type.
 */
export type PlanEstimateFieldIds = {
  size: { id: string; options: Record<PlanSize, string | undefined> } | undefined;
  estimate: string | undefined;
};

/** One ancestor of an issue, as `lineage` returns it. */
export type PlanAncestor = { number: number; title: string; body: string; kind: PlanKind | undefined };

export type SetStatusResult = "set" | "not-in-project" | "no-option";
export type SetDatesResult = "set" | "not-in-project" | "no-field";

/** An issue to create in the plan: its labels, its parent and blockers, and its Start and Target (YYYY-MM-DD). */
export type NewPlanIssue = {
  project: number;
  title: string;
  body: string;
  labels: string[];
  parent?: number | undefined;
  blockedBy?: number[] | undefined;
  start?: string | undefined;
  target?: string | undefined;
};

/** Dates to write on an item, YYYY-MM-DD: a date sets the field, null clears it, a missing key leaves it. */
export type PlanDates = { start?: string | null; target?: string | null };

/** Fields to write on an item: Start and Target as YYYY-MM-DD, Size, and Estimate in hours. A value sets the field, null clears it, a missing key leaves it. */
export type PlanFields = PlanDates & { size?: PlanSize | null; estimate?: number | null };
export type SetFieldsResult = "set" | "not-in-project" | "no-field" | "no-option";
/** The fields to write on one issue's item, for setManyPlanFields. */
export type PlanFieldsChange = { issue: number; fields: PlanFields };

/** One of the repository owner's Projects, as setup offers it: whether it is linked to the repository and which of handoff's Status options it lacks. */
export type PlanProjectChoice = { number: number; title: string; url: string; linked: boolean; missingStatusOptions: PlanStatus[] };

/** What adopting a Project changed: Status options renamed to handoff's names and those added. */
export type AdoptedProject = { project: PlanProject; renamed: { from: string; to: PlanStatus }[]; added: PlanStatus[] };

/**
 * The plan on a GitHub Project (v2) owned by the repository's owner, a user or an organization.
 * OctokitProjects in production, FakeProjects in tests. `login` is the repository owner's login, and
 * `project` is a Project number of that owner.
 */
export interface ProjectsPort {
  /** The owner's Project by number; undefined when it does not exist or the token cannot see it. */
  getProject(login: string, number: number): Promise<PlanProject | undefined>;
  /** Every item that is an issue of `repo`, across pages; draft issues, pull requests and other repositories' issues are skipped. */
  listItems(login: string, number: number, repo: RepoRef): Promise<PlanItem[]>;
  /** An issue's Status in the Project, or undefined when it is not an item. */
  getStatus(repo: RepoRef, project: number, issue: number): Promise<PlanStatus | undefined>;
  /** Sets Status; adds the issue to the Project first when `add` is true; returns what it did. */
  setStatus(repo: RepoRef, project: number, issue: number, status: PlanStatus, opts?: { add?: boolean }): Promise<SetStatusResult>;
  /** The owner's open Projects the token can write, those linked to `repo` first, most recently updated first within each group. */
  listProjects(login: string, repo: RepoRef): Promise<PlanProjectChoice[]>;
  /**
   * Makes an existing Project of the owner the plan of `repo`: links it to the repository and gives its Status
   * field handoff's options, renaming an option whose name matches apart from case and decoration
   * (an emoji, extra spaces) and adding the missing ones. Other options stay, so no item loses its value.
   */
  adoptProject(login: string, number: number, repo: RepoRef): Promise<AdoptedProject>;
  /**
   * Creates a Project under the repository's owner, a user or an organization, with handoff's Status
   * options, linked to the repository, and the Start and Target date fields unless `dateFields` is false,
   * as for a project that plans in Flow mode. Throws before creating anything when GitHub says the
   * token's user cannot create Projects for that owner.
   */
  createProject(login: string, repo: RepoRef, title: string, opts?: { dateFields?: boolean }): Promise<PlanProject>;
  /** Creates the kind labels epic, story and task on the repository when they are missing. */
  ensureLabels(repo: RepoRef): Promise<void>;
  /** Creates an issue with its labels, parent and blockers, adds it to the Project in Shaping, then sets its Start and Target when given. */
  createIssue(
    repo: RepoRef,
    input: NewPlanIssue,
  ): Promise<{ number: number; url: string }>;
  /**
   * Brings an existing issue into the plan: adds its labels, makes it a sub-issue of `parent` when
   * given, and adds it to the Project in Shaping.
   */
  addIssue(repo: RepoRef, input: { project: number; issue: number; labels: string[]; parent?: number }): Promise<void>;
  /** The parent and the grandparent of an issue, nearest first, each with title, body and kind. */
  lineage(repo: RepoRef, issue: number): Promise<PlanAncestor[]>;
  /**
   * Sets or clears (null) the Start and Target dates (YYYY-MM-DD) of an issue's item; a date left out
   * stays as it is. "no-field" when the Project lacks a date field it would write, and then nothing changes.
   */
  setDates(repo: RepoRef, project: number, issue: number, dates: PlanDates): Promise<SetDatesResult>;
  /**
   * Creates the Start and Target date fields on the owner's Project when missing and returns their ids.
   * Throws when a field of that name exists but is not a date field.
   */
  ensureDateFields(login: string, number: number): Promise<PlanDateFieldIds>;
  /**
   * Sets or clears (null) an issue's Start, Target, Size and Estimate in one request after one read; a
   * field left out stays as it is. Checks every field first: "no-field" when the Project lacks a field
   * it would write, "no-option" when its Size field lacks the size, and then nothing changes.
   */
  setPlanFields(repo: RepoRef, project: number, issue: number, fields: PlanFields): Promise<SetFieldsResult>;
  /**
   * setPlanFields for many issues of the Project in a few requests: one read of the Project, one of the
   * issues' items per hundred issues, then several items' writes in each request. Checks every issue
   * first; when any cannot be written, nothing is written and the result lists only those issues with
   * why. Otherwise every issue is "set", in the order given. Throws naming the issues already written
   * when GitHub refuses a request part way.
   */
  setManyPlanFields(repo: RepoRef, project: number, changes: PlanFieldsChange[]): Promise<{ issue: number; result: SetFieldsResult }[]>;
  /**
   * Creates the Size single select field with S, M and L and the Estimate number field on the owner's
   * Project when missing, and adds S, M and L to an existing Size field after its own options, which
   * keep their ids. Returns the ids. Throws when a field of that name exists with another type. With
   * `estimate` false it leaves a missing Estimate field out, as for a project that plans in Flow mode.
   */
  ensureEstimateFields(login: string, number: number, opts?: { estimate?: boolean }): Promise<PlanEstimateFieldIds>;
  /**
   * Moves items of the owner's Project in Project order, one move after another in the order given, 20
   * moves a request after one read of the Project. Throws naming how many moved when GitHub refuses part
   * way, and sends nothing after the refused request.
   */
  moveItems(login: string, number: number, moves: ItemMove[]): Promise<void>;
  /** Whether the token can write Projects: `project` among a classic token's scopes. */
  scopes(): Promise<{ project: boolean; classic: boolean }>;
}
