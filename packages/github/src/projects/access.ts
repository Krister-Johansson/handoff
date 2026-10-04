/** Why GitHub refused GITHUB_TOKEN for a Project. */
export type AccessReason = "scope" | "sso" | "classic-blocked";

/** GitHub refused GITHUB_TOKEN for a Project, with a sentence that says which refusal and what to do. */
export class ProjectsAccessError extends Error {
  override readonly name = "ProjectsAccessError";
  constructor(
    readonly reason: AccessReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** How a person gives GITHUB_TOKEN the project scope. */
const SCOPE_FIX = "Run gh auth refresh -s project, then set GITHUB_TOKEN=$(gh auth token).";

/**
 * What Octokit threw, as far as access needs it: a GraphqlResponseError carries the response's `headers` and
 * GitHub's `errors`, a RequestError GitHub's message and the `response` with its headers.
 */
type Thrown = { message?: unknown; errors?: unknown; headers?: unknown; response?: { headers?: unknown } };

/** A response header of the thrown error, by its lower-case name. */
function headerOf(error: Thrown, name: string): string | undefined {
  const headers = (error.headers ?? error.response?.headers) as Record<string, unknown> | undefined;
  const value = headers?.[name];
  return value === undefined || value === null ? undefined : String(value);
}

/**
 * The sentence for an organization that requires SAML single sign-on when the token is not authorized for it.
 * GitHub answers with `X-GitHub-SSO: required; url=<url>`, and the URL, which names the organization, authorizes
 * the token for an hour (https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api).
 */
function ssoSentence(header: string, owner: string | undefined): string {
  const url = /\burl=([^;\s]+)/.exec(header)?.[1];
  const organization = (url ? /\/orgs\/([^/]+)\/sso/.exec(url)?.[1] : undefined) ?? owner ?? "The organization";
  const where = "on GitHub under Settings, Developer settings, Personal access tokens, Configure SSO";
  return `${organization} uses SAML single sign-on, and GITHUB_TOKEN is not authorized for it. ${url ? `Authorize the token at ${url} within the hour, or ${where}.` : `Authorize the token ${where}.`}`;
}

/** GitHub's GraphQL errors on the thrown error, each with its type and message. */
function graphqlErrors(error: Thrown): { type?: string; message: string }[] {
  return Array.isArray(error.errors) ? error.errors.filter((e): e is { type?: string; message: string } => typeof e?.message === "string") : [];
}

/** The scope a GraphQL error says the token lacks: "requires one of the following scopes: ['read:project']". */
const SCOPE_NAMED = /requires one of the following scopes: \['([^']+)'/;
const NOT_GRANTED = /has not been granted the required scopes/;
/**
 * GitHub's refusal when an organization restricts classic tokens: "acme forbids access via a personal access
 * token (classic). Please use a GitHub App, ...". The setting is described at
 * https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization
 */
const CLASSIC_FORBIDDEN = /(?:^|\s)(\S+) forbids access via a personal access tokens? \(classic\)/;

/**
 * GitHub's refusal of GITHUB_TOKEN as a ProjectsAccessError whose message says what to do; any other error
 * comes back unchanged. `owner` is the login the request was for, named when GitHub's answer names no organization.
 */
export function accessErrorOf(error: unknown, owner?: string): unknown {
  if (error === null || typeof error !== "object" || error instanceof ProjectsAccessError) return error;
  const thrown = error as Thrown;
  const sso = headerOf(thrown, "x-github-sso");
  if (sso?.startsWith("required")) return new ProjectsAccessError("sso", ssoSentence(sso, owner), { cause: error });
  const scope = graphqlErrors(thrown).find((e) => e.type === "INSUFFICIENT_SCOPES" || NOT_GRANTED.test(e.message));
  if (scope) {
    const name = SCOPE_NAMED.exec(scope.message)?.[1] ?? "project";
    return new ProjectsAccessError("scope", `GITHUB_TOKEN lacks the ${name} scope that GitHub asks for here. ${SCOPE_FIX}`, { cause: error });
  }
  const messages = [...graphqlErrors(thrown).map((e) => e.message), ...(typeof thrown.message === "string" ? [thrown.message] : [])];
  const blocked = messages.map((m) => CLASSIC_FORBIDDEN.exec(m)).find((m) => m !== null);
  if (blocked) {
    return new ProjectsAccessError(
      "classic-blocked",
      `${blocked[1] ?? owner} does not accept classic personal access tokens, and handoff reads Projects with one. An organization owner can allow them in the organization's settings under Personal access tokens, Settings, Tokens (classic).`,
      { cause: error },
    );
  }
  return error;
}
