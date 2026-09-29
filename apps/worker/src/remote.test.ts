import { expect, test } from "vitest";
import { parseGitHubRemote } from "./remote.ts";

test("parseGitHubRemote reads owner and name from https and ssh remotes", () => {
  expect(parseGitHubRemote("https://github.com/octo/sample.git")).toEqual({ owner: "octo", name: "sample" });
  expect(parseGitHubRemote("https://github.com/octo/sample")).toEqual({ owner: "octo", name: "sample" });
  expect(parseGitHubRemote("git@github.com:octo/sample.git")).toEqual({ owner: "octo", name: "sample" });
  expect(parseGitHubRemote("/tmp/local/origin")).toBeUndefined();
});
