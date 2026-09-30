import { expect, test } from "vitest";
import { suggestProjectName } from "./project-name.ts";

test("suggestProjectName turns a repository name into a valid, unused project name", () => {
  expect(suggestProjectName("My_Repo.js", [])).toBe("my-repo-js");
  expect(suggestProjectName("sample", ["sample"])).toBe("sample-2");
  expect(suggestProjectName("--", [])).toBe("project");
});
