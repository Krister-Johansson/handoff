import { expect, test } from "vitest";
import { parseLaunchFile, previewCommand } from "./launch.ts";

const file = `{
  // Claude Code desktop writes this file; it may hold comments.
  "version": "0.0.1",
  "configurations": [
    { "name": "web", "runtimeExecutable": "pnpm", "runtimeArgs": ["dev"], "port": 5173, "env": { "NODE_ENV": "development" } },
    { "name": "api", "runtimeExecutable": "node", "runtimeArgs": ["server.js"], "cwd": "server", "port": 8080, "autoPort": false },
    { "name": "docs", "program": "scripts/docs.js", "args": ["--watch"], "url": "http://localhost:4000/docs" },
  ],
}`;

test("a launch file with comments and trailing commas lists its configurations", () => {
  const launch = parseLaunchFile(file);
  expect(launch.configurations.map((c) => c.name)).toEqual(["web", "api", "docs"]);
});

test("a file that is not a launch file says why", () => {
  expect(() => parseLaunchFile(`{ "configurations": [{ "port": 3000 }] }`)).toThrow(/name/);
  expect(() => parseLaunchFile(`{ not json`)).toThrow(/launch.json/);
});

test("a configuration becomes a command in the run's worktree, told its port in PORT", () => {
  const [web, api, docs] = parseLaunchFile(file).configurations;
  expect(previewCommand(web!, { root: "/w/run", port: 41000 })).toEqual({
    command: "pnpm",
    args: ["dev"],
    cwd: "/w/run",
    env: { NODE_ENV: "development", PORT: "41000" },
    url: "http://localhost:41000",
  });
  expect(previewCommand(api!, { root: "/w/run", port: 8080 })).toMatchObject({ command: "node", args: ["server.js"], cwd: "/w/run/server", url: "http://localhost:8080" });
  // A url keeps its path, on the port the app was given.
  expect(previewCommand(docs!, { root: "/w/run", port: 41001 })).toMatchObject({ command: "node", args: ["scripts/docs.js", "--watch"], url: "http://localhost:41001/docs" });
});

test("cwd may name the worktree with ${workspaceFolder}, and may not leave it", () => {
  const [web] = parseLaunchFile(file).configurations;
  expect(previewCommand({ ...web!, cwd: "${workspaceFolder}/apps/web" }, { root: "/w/run", port: 1 }).cwd).toBe("/w/run/apps/web");
  expect(() => previewCommand({ ...web!, cwd: "../other" }, { root: "/w/run", port: 1 })).toThrow(/outside/);
});
