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

test("a worker that cannot read the token's scopes at start keeps the port and says so", async () => {
  const lines: string[] = [];
  const projects = new FakeProjects();
  projects.scopes = async () => {
    throw new Error("getaddrinfo ENOTFOUND api.github.com");
  };
  expect(await planAccess(projects, (message) => lines.push(message))).toBe(projects);
  expect(lines).toEqual([expect.stringContaining("ENOTFOUND")]);
});
