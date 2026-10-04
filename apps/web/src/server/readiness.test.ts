import { expect, test } from "vitest";
import { ProjectsAccessError } from "@handoff/github";
import { FakeProjects } from "@handoff/github/testing";
import { launchCheck, planCheck } from "./readiness";

const file = JSON.stringify({ version: "0.0.1", configurations: [{ name: "web", runtimeExecutable: "pnpm", runtimeArgs: ["dev"], port: 5173 }] });
const fixedPort = JSON.stringify({ version: "0.0.1", configurations: [{ name: "web", runtimeExecutable: "pnpm", runtimeArgs: ["dev"], port: 5173, autoPort: false }] });
const setting = { name: "app", runtimeExecutable: "pnpm", runtimeArgs: ["dev"], args: [], port: 3000, env: {} };

test("in Docker mode the launch check says the app must listen on 0.0.0.0", () => {
  const docker = { image: "handoff-runner:2.1.285", engine: "28.5.1" };
  expect(launchCheck(file, null, docker)).toMatchObject({
    status: "ok",
    detail: "Starts configuration web with pnpm. The app gets a free port in PORT and runs in its own container; it must listen on 0.0.0.0.",
  });
  expect(launchCheck(fixedPort, null, docker).detail).toMatch(/must have port 5173.*runs in its own container; it must listen on 0\.0\.0\.0\.$/);
  expect(launchCheck(undefined, setting, docker).detail).toMatch(/App launch setting starts `pnpm dev`\. .*must listen on 0\.0\.0\.0\.$/);
  expect(launchCheck(undefined, null, docker).fix).toMatch(/In Docker workspaces the app runs in its own container and must listen on 0\.0\.0\.0/);
});

test("on the host the launch check says nothing about containers", () => {
  expect(launchCheck(file, null, null).detail).toBe("Starts configuration web with pnpm. The app gets a free port in PORT.");
  expect(launchCheck(undefined, null, null).fix).not.toMatch(/container/);
});

test("the plan check shows the access sentence for an organization", async () => {
  const sentence =
    "acme does not accept classic personal access tokens, and handoff reads Projects with one. An organization owner can allow them in the organization's settings under Personal access tokens, Settings, Tokens (classic).";
  const plan = new FakeProjects();
  plan.owners.set("acme", "Organization");
  plan.getProject = async () => {
    throw new ProjectsAccessError("classic-blocked", sentence);
  };

  // The sentence says what to do, so the check has no fix of its own.
  expect(await planCheck(plan, { repoOwner: "acme", planProjectNumber: 4 })).toEqual({ id: "plan", title: "A plan on GitHub Projects", required: false, status: "todo", detail: sentence });
});

test("in Docker mode with an Engine below 28 the launch check carries the warning", () => {
  const check = launchCheck(file, null, { image: "handoff-runner:2.1.285", engine: "27.5.1" });
  expect(check.status).toBe("ok");
  expect(check.detail).toMatch(/Docker Engine 27\.5\.1 is older than 28, so other machines on your network may reach ports published on 127\.0\.0\.1\. Update Docker to 28 or later\.$/);
});
