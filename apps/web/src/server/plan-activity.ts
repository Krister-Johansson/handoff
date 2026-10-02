import { and, desc, eq, inArray, projects, webhookDeliveries, type Db } from "@handoff/db";

/** The webhook events that report a change to the plan's issues, their hierarchy or their blockers. */
export const PLAN_ACTIVITY_EVENTS = ["issues", "sub_issues", "issue_dependencies"] as const;
export type PlanActivityEvent = (typeof PLAN_ACTIVITY_EVENTS)[number];

/** The latest change GitHub reported for a project's issues, as a line for the Plan page. */
export type GitHubActivity = {
  event: PlanActivityEvent;
  action: string | null;
  /** The issue the change is about: the issue, the sub-issue, or the blocked issue. */
  issue: number | undefined;
  /** For example "Issue #57 closed", "#58 added as a sub-issue of #41" or "#57 marked blocked by #55". */
  summary: string;
  receivedAt: Date;
};

type Payload = Record<string, unknown>;
const numberOf = (value: unknown): number | undefined => {
  const n = value && typeof value === "object" ? (value as Payload).number : undefined;
  return typeof n === "number" ? n : undefined;
};
const ref = (n: number | undefined) => (n === undefined ? "an issue" : `#${n}`);

function describe(event: PlanActivityEvent, action: string | null, payload: Payload): Pick<GitHubActivity, "issue" | "summary"> {
  if (event === "sub_issues") {
    const issue = numberOf(payload.sub_issue);
    const parent = ref(numberOf(payload.parent_issue));
    const removed = action?.endsWith("_removed");
    return { issue, summary: `${ref(issue)} ${removed ? "removed as a sub-issue of" : "added as a sub-issue of"} ${parent}` };
  }
  if (event === "issue_dependencies") {
    const issue = numberOf(payload.blocked_issue);
    const blocker = ref(numberOf(payload.blocking_issue));
    const removed = action?.endsWith("_removed");
    return { issue, summary: `${ref(issue)} ${removed ? "no longer blocked by" : "marked blocked by"} ${blocker}` };
  }
  const issue = numberOf(payload.issue);
  return { issue, summary: `Issue ${issue === undefined ? "" : `#${issue} `}${action ?? "changed"}` };
}

/**
 * The latest issues, sub_issues or issue_dependencies delivery stored for the project's repository,
 * or null when the project has no repository id or no such delivery arrived. Reads one row.
 */
export async function lastGitHubActivity(db: Db, projectId: string): Promise<GitHubActivity | null> {
  const [row] = await db
    .select({ event: webhookDeliveries.eventName, action: webhookDeliveries.action, payload: webhookDeliveries.payload, receivedAt: webhookDeliveries.receivedAt })
    .from(webhookDeliveries)
    .innerJoin(projects, eq(projects.repoId, webhookDeliveries.repoId))
    .where(and(eq(projects.id, projectId), inArray(webhookDeliveries.eventName, [...PLAN_ACTIVITY_EVENTS])))
    .orderBy(desc(webhookDeliveries.receivedAt))
    .limit(1);
  if (!row) return null;
  const event = row.event as PlanActivityEvent;
  const payload = row.payload && typeof row.payload === "object" ? (row.payload as Payload) : {};
  return { event, action: row.action, ...describe(event, row.action, payload), receivedAt: row.receivedAt };
}
