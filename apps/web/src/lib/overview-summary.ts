const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the inbox holds, as "1 review · 2 questions · 1 failed run"; empty when it holds nothing. */
export function needsYouSummary({ questions, failedRuns }: { questions: { context: Record<string, unknown> }[]; failedRuns: unknown[] }) {
  const reviews = questions.filter((q) => q.context.review).length;
  return [
    reviews > 0 && plural(reviews, "review"),
    questions.length - reviews > 0 && plural(questions.length - reviews, "question"),
    failedRuns.length > 0 && plural(failedRuns.length, "failed run"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** How many active runs are running, waiting and queued, as "1 running · 3 waiting · 1 queued". */
export function activeSummary(runs: { status: string }[]) {
  return (["running", "waiting", "queued"] as const)
    .map((status) => [status, runs.filter((r) => r.status === status).length] as const)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => `${n} ${status}`)
    .join(" · ");
}
