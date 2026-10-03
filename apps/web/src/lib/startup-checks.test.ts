import { expect, test } from "vitest";
import { gitHubCredentialsWarning } from "./startup-checks";

test("with no GitHub credential set, the dashboard warns at startup and names what to set", () => {
  const warning = gitHubCredentialsWarning({});
  expect(warning).toContain("No GitHub credentials are set");
  expect(warning).toContain("GITHUB_TOKEN");
  expect(warning).toContain("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PATH");
});

test("a GitHub App needs both its id and its key; one of them alone still warns", () => {
  expect(gitHubCredentialsWarning({ GITHUB_APP_ID: "12" })).toBeDefined();
  expect(gitHubCredentialsWarning({ GITHUB_APP_PRIVATE_KEY_PATH: "/keys/app.pem" })).toBeDefined();
  expect(gitHubCredentialsWarning({ GITHUB_TOKEN: "" })).toBeDefined();
});

test("a token or a GitHub App is enough, and nothing is said", () => {
  expect(gitHubCredentialsWarning({ GITHUB_TOKEN: "ghp_test" })).toBeUndefined();
  expect(gitHubCredentialsWarning({ GITHUB_APP_ID: "12", GITHUB_APP_PRIVATE_KEY_PATH: "/keys/app.pem" })).toBeUndefined();
});
