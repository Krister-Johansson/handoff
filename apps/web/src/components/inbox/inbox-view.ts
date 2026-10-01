import type { FailedRunItem, PullRequestItem, QuestionItem, StuckRunItem } from "./cards";

/** What waits on a person, grouped by what they must do. */
export type InboxView = {
  reviews: QuestionItem[];
  questions: QuestionItem[];
  failedRuns: FailedRunItem[];
  stuckRuns: StuckRunItem[];
  pullRequests: PullRequestItem[];
};

/** Every item in the inbox, in the order the groups show them. */
export const inboxItems = (view: InboxView) => [...view.reviews, ...view.questions, ...view.failedRuns, ...view.stuckRuns, ...view.pullRequests];

export const inboxCount = (view: InboxView) => inboxItems(view).length;

/** The inbox narrowed to one project's items, or all of it without a project. */
export function narrowInbox(view: InboxView, projectId: string | undefined): InboxView {
  if (!projectId) return view;
  const mine = <T extends { projectId: string }>(items: T[]) => items.filter((i) => i.projectId === projectId);
  return { reviews: mine(view.reviews), questions: mine(view.questions), failedRuns: mine(view.failedRuns), stuckRuns: mine(view.stuckRuns), pullRequests: mine(view.pullRequests) };
}
