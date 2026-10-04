import { expect, test } from "vitest";
import { FakeProjects } from "@handoff/github/testing";
import { planAccess } from "./plan-status.ts";

test("the worker reports once that the Plan is off when the token lacks the project scope", async () => {
  const lines: string[] = [];
  const log = (message: string) => lines.push(message);

  const withoutScope = new FakeProjects();
  withoutScope.scopesAnswer = { project: false, classic: true };
  expect(await planAccess(withoutScope, log)).toBeUndefined();
  expect(lines).toEqual([expect.stringMatching(/plan.*off.*project scope.*gh auth refresh -s project/i)]);

  lines.length = 0;
  expect(await planAccess(undefined, log)).toBeUndefined();
  expect(lines).toEqual([expect.stringMatching(/plan.*off.*GITHUB_TOKEN/i)]);

  lines.length = 0;
  const withScope = new FakeProjects();
  expect(await planAccess(withScope, log)).toBe(withScope);
  expect(lines).toEqual([]);
});

test("a fine-grained token's log line says a user's Project needs a classic token and handoff uses one classic token for every Project", async () => {
  const lines: string[] = [];
  const fineGrained = new FakeProjects();
  fineGrained.scopesAnswer = { project: false, classic: false };

  expect(await planAccess(fineGrained, (message) => lines.push(message))).toBeUndefined();
  expect(lines).toEqual([
    "The plan on GitHub Projects is off: GITHUB_TOKEN is a fine-grained token, which cannot reach a Project owned by a user, and handoff reads every Project, a user's or an organization's, with one classic token with the project scope. Runs record plan.skipped instead of moving their tasks. Run gh auth refresh -s project, then set GITHUB_TOKEN=$(gh auth token).",
  ]);

  // Without a token there is no Projects port: handoff does not reach Projects through the GitHub App.
  lines.length = 0;
  expect(await planAccess(undefined, (message) => lines.push(message))).toBeUndefined();
  expect(lines).toEqual([expect.stringContaining("GITHUB_TOKEN is not set, and handoff does not reach Projects through the GitHub App")]);
});

test("a worker that cannot read the token's scopes at start keeps the port and says so", async () => {
  const lines: string[] = [];
  const projects = new FakeProjects();
  projects.scopes = async () => {
    throw new Error("getaddrinfo ENOTFOUND api.github.com");
  };
  expect(await planAccess(projects, (message) => lines.push(message))).toBe(projects);
  expect(lines).toEqual([expect.stringContaining("ENOTFOUND")]);
});
