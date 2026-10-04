import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AppLaunchView, LaunchTestView } from "@/server/app-launch";
import { AppLaunchSettings } from "./app-launch-settings";

const actions = vi.hoisted(() => ({
  saveAppLaunchAction: vi.fn(async (): Promise<{ ok: true } | { ok: false; error?: string; errors?: Record<string, string> }> => ({ ok: true })),
  startLaunchTestAction: vi.fn(),
  launchTestAction: vi.fn(async (): Promise<unknown> => null),
  stopLaunchTestAction: vi.fn(),
}));
vi.mock("@/app/projects/launch-actions", () => actions);

const writeText = vi.fn(async () => {});
beforeEach(() => {
  Object.values(actions).forEach((a) => a.mockClear());
  Object.assign(navigator, { clipboard: { writeText } });
  writeText.mockClear();
});
afterEach(() => vi.useRealTimers());

const view = (overrides: Partial<AppLaunchView> = {}): AppLaunchView => ({
  projectId: "p1",
  projectName: "example-shop",
  branch: "main",
  docker: null,
  detected: { kind: "none" },
  saved: null,
  services: { file: "compose.yaml", names: ["postgres", "redis"] },
  seedCommand: "pnpm db:seed",
  test: null,
  ...overrides,
});

const test_ = (overrides: Partial<LaunchTestView> = {}): LaunchTestView => ({
  id: "t1",
  status: "starting",
  command: "pnpm dev",
  steps: [],
  port: null,
  url: null,
  error: null,
  log: "",
  createdAt: "2026-10-03T10:00:00.000Z",
  readyAt: null,
  stopsAt: "2026-10-03T10:10:00.000Z",
  ...overrides,
});

const section = () => screen.getByRole("region", { name: "App launch" });

test("a repository with a launch file shows it read-only, says the file wins, and offers Test start without a form", async () => {
  render(
    <AppLaunchSettings
      view={view({
        detected: {
          kind: "file",
          url: "https://github.com/octo/handoff/blob/main/.claude/launch.json",
          configurations: ["web", "web-with-github"],
          picked: { name: "web", runtimeExecutable: "pnpm", runtimeArgs: ["--filter", "@handoff/web", "dev"], args: [], port: 3000, env: {} },
        },
        services: { file: "docker-compose.yml", names: ["postgres"] },
        seedCommand: null,
      })}
    />,
  );
  const s = section();
  expect(s).toHaveTextContent("How handoff starts a run's app from its worktree, for Try it and for screenshots.");
  expect(s).toHaveTextContent("From .claude/launch.json");
  expect(s).toHaveTextContent("Detected from .claude/launch.json");
  expect(s).toHaveTextContent("The file wins over this page: edit it in the repository to change how the app starts.");
  expect(within(s).getByRole("link", { name: /View file/ })).toHaveAttribute("href", "https://github.com/octo/handoff/blob/main/.claude/launch.json");
  expect(s).toHaveTextContent("Handoff starts the one named handoff-demo, else the first.");
  expect(within(s).getByText("web", { selector: "[data-picked]" })).toBeInTheDocument();
  expect(s).toHaveTextContent("pnpm --filter @handoff/web dev");
  expect(s).toHaveTextContent("Repository root");
  expect(s).toHaveTextContent("Any free port, passed in PORT");
  expect(s).toHaveTextContent("http://localhost:<port>");
  expect(within(s).queryByRole("textbox")).not.toBeInTheDocument();
  expect(within(s).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

  // Before the app starts lists the four steps in order.
  const steps = within(within(s).getByRole("list", { name: "Before the app starts" })).getAllByRole("listitem");
  expect(steps.map((li) => li.textContent)).toEqual([
    expect.stringMatching(/^1Services.*docker-compose\.yml: postgres/),
    expect.stringMatching(/^2Seed command.*None/),
    expect.stringMatching(/^3App/),
    expect.stringMatching(/^4Ready check.*within 2 minutes/),
  ]);

  actions.startLaunchTestAction.mockResolvedValueOnce({ ok: true, test: test_() });
  fireEvent.click(within(s).getByRole("button", { name: "Test start" }));
  await waitFor(() => expect(actions.startLaunchTestAction).toHaveBeenCalledWith({ projectId: "p1" }));
  expect(await within(s).findByText("Starting the app")).toBeInTheDocument();
});

test("without a launch file or a setting the section says what fails, and Set up here opens the form", () => {
  render(<AppLaunchSettings view={view()} />);
  const s = section();
  expect(s).toHaveTextContent("Handoff does not know how to start this app");
  expect(s).toHaveTextContent("example-shop has no .claude/launch.json on main.");
  expect(s).toHaveTextContent(
    'Until then, Try it and demo steps in this project stop with "This repository has no .claude/launch.json and the project has no App launch setting, so handoff does not know how to start the app."',
  );
  expect(within(s).getByRole("link", { name: /About launch.json/ })).toHaveAttribute("href", "https://code.claude.com/docs/en/desktop");
  fireEvent.click(within(s).getByRole("button", { name: "Set up here" }));
  expect(within(s).getByRole("textbox", { name: "Command" })).toHaveValue("");
  expect(within(s).getByRole("spinbutton", { name: "Port" })).toHaveValue(3000);
  expect(within(s).getByRole("switch", { name: "Any free port" })).toBeChecked();
});

const filled = () =>
  view({
    saved: { name: "app", runtimeExecutable: "pnpm", runtimeArgs: ["dev"], args: [], cwd: "apps/storefront", port: 3000, url: "http://localhost:3000/shop", env: { NODE_ENV: "development" } },
  });

test("a saved setting fills the form; Save sends the form as typed and shows what to fix", async () => {
  render(<AppLaunchSettings view={filled()} />);
  const s = section();
  expect(s).toHaveTextContent("Set here");
  expect(within(s).getByRole("textbox", { name: "Command" })).toHaveValue("pnpm dev");
  expect(within(s).getByRole("textbox", { name: /Working directory/ })).toHaveValue("apps/storefront");
  expect(within(s).getByRole("textbox", { name: /Opens at/ })).toHaveValue("http://localhost:3000/shop");
  expect(within(s).getByRole("textbox", { name: "Variable 1 name" })).toHaveValue("NODE_ENV");
  expect(within(s).getByRole("textbox", { name: "Variable 1 value" })).toHaveValue("development");
  expect(s).toHaveTextContent("Stored as plain text. Do not put secrets here.");
  expect(s).toHaveTextContent("Test start uses the form as it is, saved or not.");

  fireEvent.click(within(s).getByRole("button", { name: "Add variable" }));
  fireEvent.change(within(s).getByRole("textbox", { name: "Variable 2 name" }), { target: { value: "NEXT_TELEMETRY_DISABLED" } });
  fireEvent.change(within(s).getByRole("textbox", { name: "Variable 2 value" }), { target: { value: "1" } });
  fireEvent.click(within(s).getByRole("switch", { name: "Any free port" }));
  fireEvent.click(within(s).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(actions.saveAppLaunchAction).toHaveBeenCalledWith({
      projectId: "p1",
      form: {
        command: "pnpm dev",
        cwd: "apps/storefront",
        port: "3000",
        anyPort: false,
        url: "http://localhost:3000/shop",
        env: [
          { name: "NODE_ENV", value: "development" },
          { name: "NEXT_TELEMETRY_DISABLED", value: "1" },
        ],
      },
    }),
  );

  actions.saveAppLaunchAction.mockResolvedValueOnce({ ok: false, errors: { command: "Type the command that starts the app, such as pnpm dev." } });
  fireEvent.change(within(s).getByRole("textbox", { name: "Command" }), { target: { value: "" } });
  fireEvent.click(within(s).getByRole("button", { name: "Save" }));
  expect(await within(s).findByText("Type the command that starts the app, such as pnpm dev.")).toBeInTheDocument();
  expect(within(s).getByRole("textbox", { name: "Command" })).toHaveAttribute("aria-invalid", "true");

  // Removing a variable drops its row.
  fireEvent.click(within(s).getByRole("button", { name: "Remove NODE_ENV" }));
  expect(within(s).queryByDisplayValue("development")).not.toBeInTheDocument();
});

test("Copy as launch.json copies the form as a file to commit", async () => {
  render(<AppLaunchSettings view={filled()} />);
  fireEvent.click(within(section()).getByRole("button", { name: "Copy as launch.json" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(JSON.parse((writeText.mock.calls[0] as unknown as [string])[0])).toEqual({
    version: "0.0.1",
    configurations: [
      { name: "app", runtimeExecutable: "pnpm", runtimeArgs: ["dev"], cwd: "apps/storefront", port: 3000, url: "http://localhost:3000/shop", env: { NODE_ENV: "development" } },
    ],
  });
  expect(await within(section()).findByRole("button", { name: "Copied" })).toBeInTheDocument();
});

test("Test start sends the unsaved form, shows each step while it starts, then the app and Stop once ready", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(<AppLaunchSettings view={filled()} />);
  const s = section();
  fireEvent.change(within(s).getByRole("textbox", { name: "Command" }), { target: { value: "pnpm start" } });
  actions.startLaunchTestAction.mockResolvedValueOnce({
    ok: true,
    test: test_({ command: "pnpm start", steps: [{ name: "worktree", status: "running", detail: "Making a fresh worktree of main", ms: null }] }),
  });
  fireEvent.click(within(s).getByRole("button", { name: "Test start" }));
  await waitFor(() => expect(actions.startLaunchTestAction).toHaveBeenCalledWith({ projectId: "p1", form: expect.objectContaining({ command: "pnpm start" }) }));
  const result = await within(s).findByRole("status", { name: "Test start" });
  expect(result).toHaveTextContent("Starting the app");
  expect(result).toHaveTextContent("Making a fresh worktree of main");

  actions.launchTestAction.mockResolvedValue(
    test_({
      status: "ready",
      command: "pnpm start",
      port: 41873,
      url: "http://localhost:41873/shop",
      readyAt: "2026-10-03T10:00:10.300Z",
      log: "> next start\nReady in 2.1s",
      steps: [
        { name: "worktree", status: "done", detail: "A fresh worktree of main at 8b2d41c", ms: 1200 },
        { name: "services", status: "done", detail: "compose.yaml: up", ms: 400 },
        { name: "seed", status: "done", detail: "`pnpm db:seed` exited 0", ms: 3100 },
        { name: "app", status: "done", detail: "Listening on port 41873", ms: 5600 },
      ],
    }),
  );
  await act(() => vi.advanceTimersByTimeAsync(1500));
  expect(result).toHaveTextContent("Ready in 10.3 s");
  expect(result).toHaveTextContent("Test start, pnpm start on port 41873");
  expect(within(result).getByRole("link", { name: /Open the app/ })).toHaveAttribute("href", "http://localhost:41873/shop");
  expect(within(result).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
    expect.stringMatching(/Worktree.*A fresh worktree of main at 8b2d41c.*1\.2 s/),
    expect.stringMatching(/Services.*compose\.yaml: up.*0\.4 s/),
    expect.stringMatching(/Seed.*pnpm db:seed exited 0.*3\.1 s/),
    expect.stringMatching(/App.*Listening on port 41873.*5\.6 s/),
  ]);
  expect(result).toHaveTextContent(/Stops by itself in \d+ minutes?/);

  actions.stopLaunchTestAction.mockResolvedValueOnce(test_({ status: "stopped", command: "pnpm start" }));
  actions.launchTestAction.mockResolvedValue(test_({ status: "stopped", command: "pnpm start" }));
  fireEvent.click(within(result).getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(actions.stopLaunchTestAction).toHaveBeenCalledWith({ projectId: "p1", id: "t1" }));
  expect(await within(s).findByText("Stopped")).toBeInTheDocument();
});

test("a failed Test start shows why with the end of the server log, and Try again starts it again", async () => {
  const failed = test_({
    status: "failed",
    port: 41873,
    error: "The app did not listen on port 41873 in time. Handoff passes the port in PORT, as Claude Code desktop does; make the dev command read PORT instead of a fixed port, or turn off Any free port in App launch.",
    log: "> next dev -p 3000\n- Local: http://localhost:3000",
    steps: [{ name: "app", status: "failed", detail: "Started, but nothing listened on port 41873", ms: 120_000 }],
  });
  render(<AppLaunchSettings view={{ ...filled(), test: failed }} />);
  const result = within(section()).getByRole("status", { name: "Test start" });
  expect(result).toHaveTextContent("The app did not start");
  expect(result).toHaveTextContent("Started, but nothing listened on port 41873");
  expect(result).toHaveTextContent("2:00");
  expect(result).toHaveTextContent("turn off Any free port");
  expect(result).toHaveTextContent("- Local: http://localhost:3000");
  actions.startLaunchTestAction.mockResolvedValueOnce({ ok: true, test: test_() });
  fireEvent.click(within(result).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(actions.startLaunchTestAction).toHaveBeenCalledWith({ projectId: "p1", form: expect.objectContaining({ command: "pnpm dev" }) }));
});

test("in Docker workspace mode the section offers Test start and says the app runs in its own container on 127.0.0.1", async () => {
  render(<AppLaunchSettings view={{ ...filled(), docker: { image: "handoff-runner:2.1.285", engine: "28.5.1" } }} />);
  const s = section();
  expect(s).toHaveTextContent(
    "Steps run in Docker containers from handoff-runner:2.1.285. The app runs in its own container from that image, published on 127.0.0.1 only, and must listen on 0.0.0.0. It reaches the services in compose.yaml at the same localhost ports as on this machine.",
  );
  expect(s).not.toHaveTextContent("not supported");
  expect(s).not.toHaveTextContent("Docker Engine 28.5.1");
  const steps = within(within(s).getByRole("list", { name: "Before the app starts" })).getAllByRole("listitem");
  expect(steps[2]).toHaveTextContent("Runs in its own container and stops when its step ends.");
  expect(steps[3]).toHaveTextContent("Ready when the app answers on its port, within 2 minutes");

  actions.startLaunchTestAction.mockResolvedValueOnce({
    ok: true,
    test: test_({
      status: "ready",
      port: 41234,
      url: "http://localhost:41234",
      readyAt: "2026-10-03T10:00:09.000Z",
      steps: [
        { name: "setup", status: "done", detail: "`pnpm install --frozen-lockfile` exited 0 in container handoff-1a2b3c4d", ms: 21_000 },
        { name: "app", status: "done", detail: "Listening on port 41234 in container handoff-preview-5e6f7a8b", ms: 4200 },
      ],
    }),
  });
  fireEvent.click(within(s).getByRole("button", { name: "Test start" }));
  const result = await within(s).findByRole("status", { name: "Test start" });
  expect(result).toHaveTextContent("pnpm install --frozen-lockfile exited 0 in container handoff-1a2b3c4d");
  expect(result).toHaveTextContent("Listening on port 41234 in container handoff-preview-5e6f7a8b");
});

test("in Docker workspace mode without a compose file the section leaves out the services sentence", () => {
  render(<AppLaunchSettings view={{ ...filled(), services: null, docker: { image: "runner:1", engine: null } }} />);
  const s = section();
  expect(s).toHaveTextContent("Steps run in Docker containers from runner:1.");
  expect(s).not.toHaveTextContent("It reaches the services");
});

test("an Engine below 28 shows the warning", () => {
  render(<AppLaunchSettings view={{ ...filled(), docker: { image: "handoff-runner:2.1.285", engine: "27.5.1" } }} />);
  const s = section();
  expect(within(s).getByRole("alert")).toHaveTextContent(
    "Docker Engine 27.5.1 is older than 28, so other machines on your network may reach ports published on 127.0.0.1. Update Docker to 28 or later.",
  );
  expect(within(s).getByRole("button", { name: "Test start" })).toBeInTheDocument();
});
