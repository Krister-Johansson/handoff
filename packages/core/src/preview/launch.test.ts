import { expect, test } from "vitest";
import {
  commandLine,
  configurationFromForm,
  demoConfiguration,
  formFromConfiguration,
  launchFileText,
  parseLaunchFile,
  previewCommand,
  SETTING_CONFIGURATION,
  splitCommand,
  type LaunchForm,
} from "./launch.ts";

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

test("the handoff-demo configuration wins over the first", () => {
  expect(demoConfiguration(parseLaunchFile(file)).name).toBe("web");
  const withDemo = parseLaunchFile(`{ "configurations": [
    { "name": "dev", "runtimeExecutable": "pnpm", "runtimeArgs": ["dev"] },
    { "name": "handoff-demo", "runtimeExecutable": "pnpm", "runtimeArgs": ["start"] },
  ] }`);
  expect(demoConfiguration(withDemo)).toMatchObject({ name: "handoff-demo", runtimeArgs: ["start"] });
});

test("a command line splits into the program and its arguments, keeping quoted words whole", () => {
  expect(splitCommand("pnpm --filter @handoff/web dev")).toEqual(["pnpm", "--filter", "@handoff/web", "dev"]);
  expect(splitCommand(`  sh -c "pnpm build && pnpm start"  `)).toEqual(["sh", "-c", "pnpm build && pnpm start"]);
  expect(splitCommand(`node -e 'console.log("hi there")' a\\ b`)).toEqual(["node", "-e", `console.log("hi there")`, "a b"]);
  expect(splitCommand("")).toEqual([]);
  expect(() => splitCommand(`sh -c "pnpm dev`)).toThrow(/quote/);
});

test("a configuration shows as one command line that splits back into the same words", () => {
  const [web, , docs] = parseLaunchFile(file).configurations;
  expect(commandLine(web!)).toBe("pnpm dev");
  expect(commandLine(docs!)).toBe("node scripts/docs.js --watch");
  const quoted = { ...web!, runtimeExecutable: "sh", runtimeArgs: ["-c", "pnpm build && pnpm start", "it's"] };
  expect(commandLine(quoted)).toBe(`sh -c 'pnpm build && pnpm start' 'it'\\''s'`);
  expect(splitCommand(commandLine(quoted))).toEqual(["sh", "-c", "pnpm build && pnpm start", "it's"]);
});

const form = (overrides: Partial<LaunchForm> = {}): LaunchForm => ({ command: "pnpm dev", cwd: "", port: "3000", anyPort: true, url: "", env: [], ...overrides });

test("the App launch form becomes one launch configuration", () => {
  expect(
    configurationFromForm(form({ command: "pnpm dev", cwd: "apps/storefront", url: "http://localhost:3000/shop", env: [{ name: "NODE_ENV", value: "development" }] })),
  ).toEqual({
    ok: true,
    configuration: {
      name: SETTING_CONFIGURATION,
      runtimeExecutable: "pnpm",
      runtimeArgs: ["dev"],
      args: [],
      cwd: "apps/storefront",
      port: 3000,
      url: "http://localhost:3000/shop",
      env: { NODE_ENV: "development" },
    },
  });
  // Any free port off: the app must have its port, as autoPort false says in the file. Empty rows are dropped.
  const exact = configurationFromForm(form({ port: "8080", anyPort: false, env: [{ name: "", value: "" }] }));
  expect(exact).toMatchObject({ ok: true, configuration: { port: 8080, autoPort: false, env: {} } });
  expect(exact.ok && "cwd" in exact.configuration).toBe(false);
});

test("a form that cannot start an app says what to fix, field by field", () => {
  const result = configurationFromForm(form({ command: "  ", cwd: "../elsewhere", port: "70000", url: "localhost:3000", env: [{ name: "1BAD", value: "x" }] }));
  expect(result).toEqual({
    ok: false,
    errors: {
      command: expect.stringMatching(/command/i),
      cwd: expect.stringMatching(/inside the repository/),
      port: expect.stringMatching(/1 to 65535/),
      url: expect.stringMatching(/http/),
      env: expect.stringMatching(/1BAD/),
    },
  });
  expect(configurationFromForm(form({ command: `sh -c "x` }))).toMatchObject({ ok: false, errors: { command: expect.stringMatching(/quote/) } });
  expect(configurationFromForm(form({ cwd: "/abs" }))).toMatchObject({ ok: false, errors: { cwd: expect.any(String) } });
  // Handoff sets PORT itself, and a name twice is a mistake.
  expect(configurationFromForm(form({ env: [{ name: "PORT", value: "1" }] }))).toMatchObject({ ok: false, errors: { env: expect.stringMatching(/PORT/) } });
  expect(configurationFromForm(form({ env: [{ name: "A", value: "1" }, { name: "A", value: "2" }] }))).toMatchObject({ ok: false, errors: { env: expect.stringMatching(/twice/) } });
});

test("a saved configuration fills the form again, and copies as a launch file handoff reads back", () => {
  const config = parseLaunchFile(file).configurations[1]!;
  expect(formFromConfiguration(config)).toEqual({ command: "node server.js", cwd: "server", port: "8080", anyPort: false, url: "", env: [] });
  const saved = configurationFromForm(form({ command: "pnpm dev", env: [{ name: "NODE_ENV", value: "development" }] }));
  if (!saved.ok) throw new Error("expected a configuration");
  const text = launchFileText(saved.configuration);
  expect(JSON.parse(text)).toEqual({
    version: "0.0.1",
    configurations: [{ name: SETTING_CONFIGURATION, runtimeExecutable: "pnpm", runtimeArgs: ["dev"], port: 3000, env: { NODE_ENV: "development" } }],
  });
  expect(demoConfiguration(parseLaunchFile(text))).toMatchObject({ runtimeExecutable: "pnpm", runtimeArgs: ["dev"], port: 3000 });
});
