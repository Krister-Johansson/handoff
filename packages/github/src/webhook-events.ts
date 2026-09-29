export const prKey = (repoId: number, prNumber: number) => `gh:pr:${repoId}:${prNumber}`;

type Payload = Record<string, unknown>;
const obj = (v: unknown): Payload => (v && typeof v === "object" ? (v as Payload) : {});
const numbers = (list: unknown): number[] =>
  Array.isArray(list) ? list.map((pr) => obj(pr).number).filter((n): n is number => typeof n === "number") : [];

/** Keys of waiting executions a webhook should wake. PR node executions wait on gh:pr:<repoId>:<number>. */
export function correlationKeys(event: string, payload: Payload): string[] {
  const repoId = obj(payload.repository).id;
  if (typeof repoId !== "number") return [];
  let prs: number[] = [];
  switch (event) {
    case "pull_request":
    case "pull_request_review":
    case "pull_request_review_comment":
    case "pull_request_review_thread":
      prs = numbers([payload.pull_request]);
      break;
    case "issue_comment": {
      const issue = obj(payload.issue);
      if (issue.pull_request) prs = numbers([issue]);
      break;
    }
    case "check_run":
      prs = numbers(obj(payload.check_run).pull_requests);
      break;
    case "check_suite":
      prs = numbers(obj(payload.check_suite).pull_requests);
      break;
    case "workflow_run":
      prs = numbers(obj(payload.workflow_run).pull_requests);
      break;
  }
  return [...new Set(prs)].map((n) => prKey(repoId, n));
}
