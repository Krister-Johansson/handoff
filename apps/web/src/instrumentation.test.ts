import { afterEach, expect, test, vi } from "vitest";
import { register } from "./instrumentation";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const noGitHub = () => {
  vi.stubEnv("GITHUB_TOKEN", "");
  vi.stubEnv("GITHUB_APP_ID", "");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY_PATH", "");
};

test("the Node.js server logs a warning at startup when no GitHub credentials are set", async () => {
  noGitHub();
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await register();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("No GitHub credentials are set"));
});

test("with a token set, startup says nothing", async () => {
  noGitHub();
  vi.stubEnv("GITHUB_TOKEN", "ghp_test");
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await register();
  expect(warn).not.toHaveBeenCalled();
});

test("the edge runtime does not check", async () => {
  noGitHub();
  vi.stubEnv("NEXT_RUNTIME", "edge");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await register();
  expect(warn).not.toHaveBeenCalled();
});
