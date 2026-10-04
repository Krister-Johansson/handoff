import { RequestError } from "octokit";
import { expect, test } from "vitest";
import { accessErrorOf, ProjectsAccessError } from "./access.ts";

/** What Octokit's GraphqlResponseError carries: the response's headers, its errors and the data next to them. */
const graphqlError = (errors: { type?: string; message: string }[], headers: Record<string, string> = {}) =>
  Object.assign(new Error(`Request failed due to following response errors:\n${errors.map((e) => ` - ${e.message}`).join("\n")}`), {
    name: "GraphqlResponseError",
    headers,
    errors,
    data: null,
  });

test("a missing scope names the scope GitHub asks for", () => {
  // As GitHub words it, quoted in https://github.com/cli/cli/issues/11308.
  const message =
    "Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:project'], but your token has only been granted the: ['repo'] scopes. Please modify your token's scopes at: https://github.com/settings/tokens.";
  const error = graphqlError([{ type: "INSUFFICIENT_SCOPES", message }]);

  const converted = accessErrorOf(error, "acme");

  expect(converted).toBeInstanceOf(ProjectsAccessError);
  expect(converted).toMatchObject({
    reason: "scope",
    message: "GITHUB_TOKEN lacks the read:project scope that GitHub asks for here. Run gh auth refresh -s project, then set GITHUB_TOKEN=$(gh auth token).",
    cause: error,
  });
  // Matched by the message alone too, in case the type is missing.
  expect(accessErrorOf(graphqlError([{ message }]))).toMatchObject({ reason: "scope", message: expect.stringContaining("read:project") });
});

/** An HTTP refusal as Octokit throws it, with GitHub's headers and body. */
const refusal = (status: number, headers: Record<string, string>, message: string) =>
  new RequestError(message, status, {
    request: { method: "POST", url: "https://api.github.com/graphql", headers: {} },
    response: { url: "https://api.github.com/graphql", status, headers, data: { message } },
  });

test("a 403 with X-GitHub-SSO names the organization and the authorization URL", () => {
  // https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api: on a 403 the X-GitHub-SSO header holds the URL that authorizes the token.
  const url = "https://github.com/orgs/acme/sso?authorization_request=A1B2C3";
  const error = refusal(403, { "x-github-sso": `required; url=${url}` }, "Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.");

  expect(accessErrorOf(error, "acme")).toMatchObject({
    reason: "sso",
    message: `acme uses SAML single sign-on, and GITHUB_TOKEN is not authorized for it. Authorize the token at ${url} within the hour, or on GitHub under Settings, Developer settings, Personal access tokens, Configure SSO.`,
    cause: error,
  });
  // The same header on a GraphQL answer with errors, and the organization named by the URL when the request named none.
  const answered = graphqlError([{ type: "FORBIDDEN", message: "Resource protected by organization SAML enforcement." }], { "x-github-sso": `required; url=${url}` });
  expect(accessErrorOf(answered)).toMatchObject({ reason: "sso", message: expect.stringMatching(/^acme uses SAML single sign-on/) });
});

test("a 403 that says classic tokens are forbidden names the organization setting", () => {
  // GitHub's wording, quoted in https://github.com/refined-github/refined-github/issues/6951; the setting is
  // https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization
  const message = "acme forbids access via a personal access token (classic). Please use a GitHub App, OAuth App, or a personal access token with fine-grained permissions.";
  const error = refusal(403, {}, message);
  const sentence =
    "acme does not accept classic personal access tokens, and handoff reads Projects with one. An organization owner can allow them in the organization's settings under Personal access tokens, Settings, Tokens (classic).";

  expect(accessErrorOf(error, "someone-else")).toMatchObject({ reason: "classic-blocked", message: sentence, cause: error });
  expect(accessErrorOf(graphqlError([{ type: "FORBIDDEN", message }]))).toMatchObject({ reason: "classic-blocked", message: sentence });
});

test("other errors pass through unchanged", () => {
  const notFound = graphqlError([{ type: "NOT_FOUND", message: "Could not resolve to a ProjectV2 with the number 9." }]);
  const failed = refusal(502, {}, "Bad Gateway");
  const rateLimited = refusal(403, { "x-ratelimit-remaining": "0" }, "API rate limit exceeded for user ID 1.");
  const plain = new Error("getaddrinfo ENOTFOUND api.github.com");

  for (const error of [notFound, failed, rateLimited, plain, "a string", undefined]) expect(accessErrorOf(error, "acme")).toBe(error);
});
