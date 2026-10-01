import { expect, test } from "vitest";
import { FakeGitHub } from "@handoff/github/testing";
import { linkDependencies } from "./link-dependencies";

const repo = { owner: "octo", name: "sample" };
const open = (number: number, body: string, blockedBy: number[] = []) => ({ number, title: `F0${number}`, url: `https://github.com/octo/sample/issues/${number}`, body, state: "open" as const, blockedBy });

test("Depends on lines become GitHub blocked-by links, for open blockers not linked yet", async () => {
  const github = new FakeGitHub();
  github.issues.set(3, { ...open(3, "No dependencies."), state: "closed" });
  github.issues.set(5, open(5, "Depends on: #3 (F03)"));
  github.issues.set(6, open(6, "Depends on: #3 (F03)"));
  github.issues.set(7, open(7, "Depends on: #5 (F05), #6 (F06)", [5]));

  expect(await linkDependencies(github, repo)).toEqual([{ issue: 7, blocker: 6 }]);
  expect(github.issues.get(7)!.blockedBy).toEqual([5, 6]);
  // A closed dependency blocks nothing, so it is not linked; a second pass finds nothing to do.
  expect(github.issues.get(5)!.blockedBy ?? []).toEqual([]);
  expect(await linkDependencies(github, repo)).toEqual([]);
});
