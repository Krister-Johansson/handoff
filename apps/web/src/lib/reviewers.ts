/** A review bot's name as people say it; anyone else by their login. */
export const reviewerName = (login: string) => (/^coderabbitai(\[bot\])?$/i.test(login) ? "CodeRabbit" : login.replace(/\[bot\]$/i, ""));

/** A reviewer a PR step waits for after handoff answered its comments, and whether it is a bot, which reviews where a person replies. */
export type ReReviewer = { login: string; bot: boolean };

/** What a PR step waits on after handoff answered review comments: whose next review, and how many answered comments wait for it. */
export type ReReviewWait = { reviewers: ReReviewer[]; items: number };

const andList = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** "CodeRabbit's next review", "Krister-Johansson's reply", or the reviewers' names when there are several. */
export function whoseReview(reviewers: ReReviewer[]): string {
  const [one] = reviewers;
  if (reviewers.length === 1 && one) return `${reviewerName(one.login)}'s ${one.bot ? "next review" : "reply"}`;
  return andList(reviewers.map((r) => reviewerName(r.login)));
}
