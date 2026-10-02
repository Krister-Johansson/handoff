/**
 * A read GitHub could not answer, and why: "not-found" when GitHub says the thing does not exist (404),
 * "unreachable" when the network failed or GitHub failed (5xx) or refused (rate limit, credentials).
 */
export class GitHubReadError extends Error {
  override readonly name = "GitHubReadError";
  constructor(
    readonly reason: "not-found" | "unreachable",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Turns what Octokit threw into a GitHubReadError: a 404 is not-found, anything else unreachable. */
export function readError(error: unknown, what: string): GitHubReadError {
  if (error instanceof GitHubReadError) return error;
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 404) return new GitHubReadError("not-found", `${what} does not exist on GitHub.`, { cause: error });
  const detail = error instanceof Error ? error.message : String(error);
  return new GitHubReadError("unreachable", `GitHub did not answer for ${what}: ${detail}`, { cause: error });
}
