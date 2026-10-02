import { expect, test } from "vitest";
import { fakeFetch } from "../testing/fake-fetch.ts";
import { projectsFromEnv } from "./from-env.ts";
import { OctokitProjects } from "./octokit-projects.ts";

test("projectsFromEnv returns a port for GITHUB_TOKEN and undefined for a GitHub App alone", () => {
  expect(projectsFromEnv({ GITHUB_TOKEN: "ghp_x" })).toBeInstanceOf(OctokitProjects);
  // A GitHub App cannot reach a user-owned Project, so the App's settings alone give no port.
  expect(projectsFromEnv({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY_PATH: "/keys/app.pem" })).toBeUndefined();
  // With both, the token serves the plan.
  expect(projectsFromEnv({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY_PATH: "/keys/app.pem", GITHUB_TOKEN: "ghp_x" })).toBeInstanceOf(OctokitProjects);
  expect(projectsFromEnv({})).toBeUndefined();
});

test("scopes reports project missing from a token's X-OAuth-Scopes", async () => {
  const user = (headers: Record<string, string>) => fakeFetch({ "GET /user": () => ({ json: { login: "octo" }, headers }) }).fetch;

  const withProject = OctokitProjects.withToken("t", { fetch: user({ "x-oauth-scopes": "admin:public_key, gist, project, read:org, repo, workflow" }) });
  expect(await withProject.scopes()).toEqual({ project: true, classic: true });

  // read:project reads Projects but cannot write Status.
  const readOnly = OctokitProjects.withToken("t", { fetch: user({ "x-oauth-scopes": "repo, read:project" }) });
  expect(await readOnly.scopes()).toEqual({ project: false, classic: true });

  const without = OctokitProjects.withToken("t", { fetch: user({ "x-oauth-scopes": "repo, read:org" }) });
  expect(await without.scopes()).toEqual({ project: false, classic: true });

  // A fine-grained token sends no X-OAuth-Scopes header and cannot reach user Projects.
  const fineGrained = OctokitProjects.withToken("t", { fetch: user({}) });
  expect(await fineGrained.scopes()).toEqual({ project: false, classic: false });
});
