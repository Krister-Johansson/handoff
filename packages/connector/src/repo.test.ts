import { expect, test } from "vitest";
import { parseGitHubRemote } from "./repo.ts";

test("a GitHub remote in any common form gives owner/name", () => {
  expect(parseGitHubRemote("git@github.com:Krister-Johansson/handoff-sandbox.git")).toBe("Krister-Johansson/handoff-sandbox");
  expect(parseGitHubRemote("https://github.com/octo/sample")).toBe("octo/sample");
  expect(parseGitHubRemote("https://github.com/octo/sample.git\n")).toBe("octo/sample");
  expect(parseGitHubRemote("ssh://git@github.com/octo/sample.git")).toBe("octo/sample");
  expect(parseGitHubRemote("https://x-access-token:abc@github.com/octo/sample.git")).toBe("octo/sample");
});

test("anything else is not a GitHub repository", () => {
  expect(parseGitHubRemote("https://gitlab.com/octo/sample.git")).toBeUndefined();
  expect(parseGitHubRemote("/Users/me/bare.git")).toBeUndefined();
  expect(parseGitHubRemote("")).toBeUndefined();
});
