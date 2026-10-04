import { expect, test } from "vitest";
import { launchCheck } from "./readiness";

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

test("in Docker mode with an Engine below 28 the launch check carries the warning", () => {
  const check = launchCheck(file, null, { image: "handoff-runner:2.1.285", engine: "27.5.1" });
  expect(check.status).toBe("ok");
  expect(check.detail).toMatch(/Docker Engine 27\.5\.1 is older than 28, so other machines on your network may reach ports published on 127\.0\.0\.1\. Update Docker to 28 or later\.$/);
});
