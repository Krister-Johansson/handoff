import { expect, test } from "vitest";
import { passEnvProblem, pickEnv } from "./pass-env.ts";

test("passEnvProblem accepts ordinary variable names", () => {
  expect(passEnvProblem(["TEST_DATABASE_URL_APP", "FEATURE_X"])).toBeUndefined();
});

test("passEnvProblem refuses the worker's own secrets", () => {
  for (const name of ["GITHUB_TOKEN", "GH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "GITHUB_WEBHOOK_SECRET", "DATABASE_URL"]) {
    expect(passEnvProblem([name])).toMatch(name);
  }
});

test("passEnvProblem refuses names that are not variable names", () => {
  expect(passEnvProblem(["A=B"])).toMatch(/A=B/);
  expect(passEnvProblem("FOO")).toMatch(/list/);
});

test("pickEnv copies only the named variables that are set", () => {
  expect(pickEnv(["A", "MISSING"], { A: "1", B: "2" })).toEqual({ A: "1" });
});
