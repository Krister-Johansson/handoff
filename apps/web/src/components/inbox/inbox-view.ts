import type { PermissionRequestView } from "@/components/runs/permission-card";
import type { FailedRunItem, PullRequestItem, QuestionItem, ReadyToMergeItem, StuckRunItem } from "./cards";

/** A step's permission request, with the run and project it belongs to. */
export type InboxPermission = PermissionRequestView & { projectId: string; projectName: string; task: string };

/** What waits on a person, grouped by what they must do. */
export type InboxView = {
  reviews: QuestionItem[];
  questions: QuestionItem[];
  failedRuns: FailedRunItem[];
  stuckRuns: StuckRunItem[];
  pullRequests: PullRequestItem[];
  readyToMerge: ReadyToMergeItem[];
  /** Steps waiting for a person to allow a tool call; they come first, since the step is blocked meanwhile. */
  permissions?: InboxPermission[];
};

/** Every item in the inbox, in the order the groups show them. */
export const inboxItems = (view: InboxView) => [...(view.permissions ?? []), ...view.reviews, ...view.questions, ...view.readyToMerge, ...view.failedRuns, ...view.stuckRuns, ...view.pullRequests];

export const inboxCount = (view: InboxView) => inboxItems(view).length;

/** The inbox narrowed to one project's items, or all of it without a project. */
export function narrowInbox(view: InboxView, projectId: string | undefined): InboxView {
  if (!projectId) return view;
  const mine = <T extends { projectId: string }>(items: T[]) => items.filter((i) => i.projectId === projectId);
  return {
    reviews: mine(view.reviews),
    questions: mine(view.questions),
    readyToMerge: mine(view.readyToMerge),
    failedRuns: mine(view.failedRuns),
    stuckRuns: mine(view.stuckRuns),
    pullRequests: mine(view.pullRequests),
    permissions: mine(view.permissions ?? []),
  };
}
