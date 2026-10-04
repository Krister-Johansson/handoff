# Start the app in Docker workspaces

## Context

Issue #264 asks handoff to start a run's app so a person can try it. Most of it is on main (#269, #272 and the App launch setting): the launch configuration comes from `.claude/launch.json` or the project's App launch setting, compose services start once per project, the app gets a free port in `PORT`, readiness waits for the port, the app runs in its own process group, and Test start in Project settings runs the same steps from a fresh worktree for 10 minutes (PR 547). The open piece, per the issue's last comment, is Docker workspace mode: with `HANDOFF_WORKSPACE=docker` and the runner image from `pnpm docker:runner`, `startPreview` refuses with "Previews do not run in Docker workspaces yet" (`packages/engine/src/preview/preview.ts:325`), so the Try it gate shows no app, every Demo step fails with `preview_failed`, and App launch hides Test start behind "Starting the app is not supported in Docker workspaces yet." (`apps/web/src/lib/app-launch.ts:2`).

This plan makes the three entry points work in Docker mode: the Try it gate's app (`ensurePreview` in `packages/engine/src/executors/human-gate.ts`), the Demo step (`packages/engine/src/executors/demo.ts`) and Test start (`packages/engine/src/preview/launch-test.ts`).

Read `CLAUDE.md`, `GLOSSARY.md` (App launch), `docs/plan.md` (M6 Docker isolation) and the README section "Running each run in a container" first.

## Goals

- In Docker mode the app runs in Linux from the image the run's steps use, against the `node_modules` the setup command installed in the run's container.
- The app is reachable from the person's browser at `http://localhost:<port>`, and from nowhere else: the port is published on the loopback addresses only.
- The app reaches the project's compose services at the same `localhost` ports it would use on the host, so `DATABASE_URL=postgres://...@localhost:5432/...` in the launch env or in the repository's own `.env` files keeps working.
- Readiness, the log tail, the server log warnings, stopping, the 10 minute Test start limit and cleanup after a worker restart behave as in worktree mode, with messages that say what to change.
- The Demo step's browser reaches the app in Docker mode.
- App launch offers Test start in Docker mode and says how the app runs there.

## Non-goals

- Previews on a remote Docker host or with workers on several hosts. handoff runs on one machine (`docs/plan.md`, risks).
- A login or proxy in front of the app. Loopback publishing is the protection.
- Rewriting the app's configuration files or environment values to point at other hosts.
- Hot reload of host edits inside the container. The person tries what the run built.
- Changing how worktree mode starts the app, beyond the shared cleanup fix in PR 4.

## Verified facts

Code facts are from `main` at `a5ccbe0`, read on 2026-10-04. Docker facts come from experiments on this machine the same day: Docker Desktop 28.5.1 on macOS, aarch64, with throwaway `node:22-alpine` containers named `hx-*` that the scripts removed.

### The Docker workspace

- `DockerWorkdirProvider` (`packages/engine/src/workdir/docker.ts:28-78`) makes one container per run named `handoff-<runId>` (`:31-33`) with `docker run -d` (`:46-64`): label `handoff.run=<runId>`, `HOME=/tmp`, the git identity variables, `--user` as the worker's uid:gid unless set (`:45`, `:56`), `--network` when `HANDOFF_DOCKER_NETWORK` is set (`:57`), every mount and the worktree mounted at the same path (`:58`), workdir the worktree, command `sleep infinity`. It publishes no port.
- `acquire` restarts a stopped container (`:42`) and reuses a running one; `release` runs `docker rm -f` and removes the worktree (`:74-77`).
- The worktree stays on the host (`:24-26`). `GitWorktreeProvider` keeps clones under `<HANDOFF_HOME>/repos/<hash>` and worktrees under `<HANDOFF_HOME>/worktrees/<runId>` (`packages/engine/src/workdir/git-worktree.ts:27`, `:31`), so a worktree's git directory, where preview logs go, is under `HANDOFF_HOME`, which the worker always mounts (`apps/worker/src/app.ts:78`).
- `docker/runner.Dockerfile` is `node:24` plus `@anthropic-ai/claude-code@2.1.285` and `pnpm@12.6.0` installed globally, `DISABLE_AUTOUPDATER=1` and `CMD ["sleep", "infinity"]`. `pnpm docker:runner` tags it `handoff-runner:2.1.285` (`package.json:28`). Live, the local image is arm64, has Node v24.18.0, and has no `socat`, no `chromium`, no `google-chrome` and no Playwright browser cache.
- The worker builds the provider from `HANDOFF_DOCKER_IMAGE`, `HANDOFF_HOME` plus `HANDOFF_DOCKER_MOUNTS`, and `HANDOFF_DOCKER_NETWORK` (`apps/worker/src/app.ts:78`, `:85-86`; `apps/worker/src/env.ts:24-30`). In Docker mode Claude runs inside the run's container through `docker exec` (`app.ts:33`, `packages/engine/src/executors/cli-node.ts:241`), and the permission MCP server is left out because it runs on the host (`cli-node.ts:212-217`).
- `shell` runs a command inside a container with `docker exec -e NAME ... -w <cwd> <container> sh -c <command>`; values reach the container through the docker client's environment, never argv (`packages/engine/src/contract/checks.ts:48-54`). `setUpWorkdir` runs the project's setup command that way in Docker mode (`packages/engine/src/workdir/setup.ts:46`), so a run's `node_modules` are built for the container's Linux.
- The Docker tests run with `HANDOFF_TEST_DOCKER=1` on `node:22-alpine` (`packages/engine/src/workdir/docker.integration.test.ts:14-15`). CI sets `HANDOFF_TEST_DOCKER=1` on the integration shards and pulls `node:22-alpine` on `ubuntu-latest` (`.github/workflows/ci.yml:68-95`), so CI runs the Docker tests on Linux.

### Starting the app today

- `startPreview` refuses any workdir with a container (`preview.ts:325`), then reads the configuration (`launchConfigurationFor`, `:112-136`), checks `passEnv` (`:327-328`) and calls `launchApp` (`:333-343`). It inserts the `previews` row in `onSpawn`, after the process is spawned (`:339-342`).
- `launchApp` (`preview.ts:170-249`): services through `ensureServices` (`:174-183`); the seed command through `shell` with no container (`:188`), so on the host; a port from `portFor` (`:202`, `:97-106`), which asks the host for a free port or checks the exact one when `autoPort` is false; `previewCommand` sets `PORT` and the URL (`packages/core/src/preview/launch.ts:197-205`, URL `http://localhost:<port>` unless the configuration has `url`); the app is spawned on the host, detached, in its own process group, with `commandEnv()` minus `CI`, the picked `passEnv` values, the run identity and the configuration's env, its output appended to `handoff-preview-<uuid>.log` in the worktree's git directory (`:209-219`).
- Readiness polls `listening(port)` every 200 ms for up to 120 s (`READY_TIMEOUT_MS`, `:24`, `:232-246`). `listening` counts a TCP connect on `127.0.0.1` or `::1` as ready (`:252-262`). Failures say the app exited, never listened on `PORT`, or could not start, with the log tail (`:227-245`).
- `ensureServices` runs `docker compose -p handoff-<projectId[0:8]> -f <file> up -d --wait --no-recreate` from the worktree on the host (`:75-88`). When another stack holds the ports it notes that and goes on (`:83-86`). Live, todooverkill's stack `handoff-6c588fd7` has one service, `handoff-6c588fd7-db-1` from `postgres:17`.
- Stopping: `stopPreview` sends SIGTERM to the process group, SIGKILL after 5 s (`stopGroup`, `:289-294`, `STOP_GRACE_MS` `:25`), and marks the row stopped (`:353-358`). `stopStepPreviews` runs when a Try it gate is answered (`human-gate.ts:328`) and after a Demo (`demo.ts:165`); `stopRunPreviews` on cancel (`packages/engine/src/operations.ts:79`).
- `previews` (`packages/db/src/schema/previews.ts:12-35`) has `workerId`, `status`, `pid`, `port`, `url`, `logPath`, no container column.
- At start a worker calls `stopWorkerPreviews(db, deps.workerId)` (`packages/engine/src/scheduler/worker.ts:148`), which stops rows with that worker id (`preview.ts:373-376`). The worker id is `HANDOFF_WORKER_ID` or `${hostname()}:${process.pid}` (`app.ts:57`), and `.env.example:12` leaves `HANDOFF_WORKER_ID` empty. So with the default id a restarted worker has a new id and does not stop the previews its previous process left. `liveWorkers` (`packages/db/src/ops/workers.ts:24-29`) can tell which worker ids are no longer live.
- The Try it gate starts the app in `ensurePreview` and returns a running row as it is, without checking the process is alive (`human-gate.ts:211-237`). "Start the app again" wakes the gate (`restartTryIt`, `operations.ts:145-149`; `restartTryItAction`, `apps/web/src/app/inbox/actions.ts:136`). The page shows "Open the app" with the URL (`apps/web/src/components/review/try-review.tsx:110-143`); `get_run` returns it as `app_url` (`apps/web/src/server/agent-mcp.ts:120`).
- The Demo step starts the app, then runs Claude with the Playwright MCP server `@playwright/mcp@0.0.83`, started with `npx -y ... --headless --isolated --allowed-origins <app origin>` (`demo.ts:12`, `:123`). Claude starts its MCP servers itself, so in Docker mode the browser would run inside the container Claude runs in. The worker passes no `browser` option (`app.ts:72`), so the server's default browser applies (`demo.ts:18-19`). The demo reads the server log from `preview.logPath` for warnings (`demo.ts:161`).

### Test start

- Test start runs in the dashboard's process, not the worker: `startLaunchTestAction` (`apps/web/src/app/projects/launch-actions.ts:56-80`) calls `startLaunchTest`, which makes a worktree with a `GitWorktreeProvider` (`apps/web/src/server/app-launch.ts:90-93`; the deps comment says "git worktrees, never containers", `launch-test.ts:20`), runs the setup command on the host (`launch-test.ts:111-120`), then `launchApp`. A timer stops it after `LAUNCH_TEST_LIFETIME_MS`, 10 minutes (`:13`, `:78`), and reading it past `stopsAt` stops it too, which covers a restarted dashboard (`:192-202`).
- In Docker mode the action refuses with `DOCKER_NOT_SUPPORTED` (`launch-actions.ts:65`), and the section shows that sentence and hides Test start (`apps/web/src/components/projects/app-launch-settings.tsx:644-692`). The dashboard knows the mode from the same `.env` (`dockerWorkspace`, `apps/web/src/server/app-launch.ts:53`).
- `launch_tests` (`packages/db/src/schema/launch-tests.ts`) has `pid`, `port`, `url`, `logPath`, `worktreePath` and the steps `worktree`, `setup`, `services`, `seed`, `app`.

### Docker Desktop, tried on this machine

- E1. A container started with `-p 127.0.0.1:47811:47811` and nothing listening inside: a TCP connect from the host to `127.0.0.1:47811` succeeds, then the connection closes without data. Today's `listening` check would call that app ready.
- E2. An app inside that listens on `127.0.0.1` only: the same connect then close without data. Listening on `0.0.0.0`: an HTTP request through `127.0.0.1` gets `HTTP/1.1 200 OK`, and `::1` is refused because only `127.0.0.1` was published.
- E3. `--network container:<other>` together with `-p` fails: "conflicting options: port publishing and the container type network mode".
- E4. From a container, `host.docker.internal:<port>` reaches a host process bound to `127.0.0.1`, and a port another container published on `127.0.0.1`.
- E5. `--add-host host.docker.internal:host-gateway` is accepted and resolves to `192.168.65.254`, which reaches the same host process.
- E6. Creating a new network failed: "all predefined address pools have been fully subnetted". The daemon has 32 networks, most of them compose `<name>_default` networks.
- E7. Killing the host's `docker exec` client with SIGTERM leaves the process it started running inside the container.
- E8. Publishing a host port another container holds fails with "Bind for 127.0.0.1:47818 failed: port is already allocated", and leaves the new container in the Created state.
- E9. `-p 127.0.0.1:47819:47819 -p '[::1]:47819:47819'` publishes on both loopback addresses, and both answer HTTP.

### Docker documentation, through Context7 (`/docker/docs`)

- `-p 127.0.0.1:8080:80 -p '[::1]:8080:80'` restricts a published port to the host. "Releases older than 28.0.0 may allow hosts within the same L2 segment to reach ports published to localhost." (`manuals/engine/network/port-publishing.md`)
- `host-gateway` is a special `--add-host` value. Docker Desktop resolves `host.docker.internal` itself; on Linux the flag is required, and `host-gateway` resolves to the host's IP on the default bridge network, such as `172.17.0.1`, not to localhost (`data/cli/engine/docker_container_run.yaml`, `manuals/compose/how-tos/networking.md`).

## Unverified

- Linux behaviour of E1, E2 and E9: whether a connect to a published loopback port with no listener also closes without data, and whether publishing `[::1]` fails on a host without IPv6. The Docker tests in PR 1 and PR 3 run on CI's `ubuntu-latest` and record it.
- On Linux, whether a host service bound to `0.0.0.0` (the compose default for `"5432:5432"`) is reachable through `host-gateway` from a container on a user-defined network such as `HANDOFF_DOCKER_NETWORK`. A service bound to `127.0.0.1` on a Linux host is not reachable that way, per the documentation above.
- Whether a container on an `--internal` network can publish a port. E6 could not create a network to try it.
- Whether `docker exec <container> kill -TERM -1` as the container's user reaches every process the app started. PR 3 tests it.
- Which browser and which install command `@playwright/mcp@0.0.83` needs inside an arm64 Linux image. Google Chrome for Linux may not be available on arm64; Chromium is the likely choice. PR 5 finds out and records it.
- Whether `npx -y @playwright/mcp@0.0.83` inside the container reaches the npm registry on an egress-restricted `HANDOFF_DOCKER_NETWORK`, and whether an image-time install is found at run time with `HOME=/tmp`.

## Decisions

### 1. The app runs in its own container, a sibling of the run's

Each preview gets a container `handoff-preview-<previewId[0:8]>` from the same image, with the same mounts, user, network and environment as the run's container `handoff-<runId>`. handoff reads those with `docker inspect handoff-<runId>`, so the two never drift apart. The worktree is mounted at the same path, so `node_modules` from the setup command, the log file in the worktree's git directory and every path in the launch configuration resolve the same.

Why not `docker exec` into the run's container: Docker cannot publish a port on a running container, and the run's container is created long before any Try it gate, by `acquire` (`docker.ts:46-64`). Publishing at `acquire` would reserve a host port for every run, preview or not, and a stopped container restarted by `acquire` (`docker.ts:42`) could find its port taken. A forwarding container that shares the run container's network namespace cannot publish either (E3). And killing a `docker exec` client leaves the app running (E7), so stopping it would need a pid file and an in-container kill; removing a sibling container stops everything in it.

Why not run the app on the host as today: the setup command installed dependencies for the container's Linux, and the reason to pick Docker mode is that agent-written code runs isolated.

### 2. The container's main process forwards service ports; the app runs through `docker exec`

The preview container starts with `--init` and runs a small Node script, `handoff-forward.mjs`, that handoff writes next to the log in the worktree's git directory. Node is in every runner image because the Claude CLI needs it. The script listens on `127.0.0.1:<P>` inside the container for each service port `P` and forwards each connection to `host.docker.internal:<P>` (Decision 5). It keeps the container alive.

The seed command then runs inside it with the existing `shell(..., container)`. The app starts with `docker exec -e NAME ... -w <cwd> <preview container> <command> <args>`, spawned on the host detached, with its output appended to the same log file as today. The client's exit is the app's exit, with its code. So `logTail`, `serverLogWarnings` and the failure messages stay as they are.

### 3. One port number on both sides, published on loopback only

handoff picks a free host port `H` with `portFor` as today, passes `PORT=H` to the app, and publishes `-p 127.0.0.1:H:H -p [::1]:H:H` (E9). The URL is the one `previewCommand` builds, `http://localhost:H`, and it works on the host and inside the container alike. A different host and container port would break apps that build absolute URLs from `PORT`.

When `docker run` fails with "port is already allocated" or "address already in use" (E8), handoff removes the Created container and tries a new free port, up to three times. With `autoPort: false` it tries once and fails with today's message. When the `[::1]` binding is refused, it publishes `127.0.0.1` only; browsers fall back to IPv4 for `localhost`.

The app gets `HOST=0.0.0.0` in its environment, since a published port reaches the container's own address, not its loopback (E2). Handoff does not otherwise change how the app binds.

### 4. Ready means the app answered through the published port

In Docker mode a TCP connect is not enough (E1, E2). handoff connects to `127.0.0.1:H` from the host, sends `GET / HTTP/1.0`, and counts any bytes back within 5 seconds as ready. This checks the path the person's browser takes. When the deadline passes, one `docker exec` probe of `127.0.0.1:H` inside the container tells the two failures apart:

- something listens inside on loopback only: "The app listens on port H only on 127.0.0.1 inside its container, so your browser cannot reach it. Make the dev server listen on 0.0.0.0, for example with its host option. Handoff sets HOST=0.0.0.0, which not every dev server reads."
- nothing listens: today's message about reading `PORT`.

Worktree mode keeps `listening`.

### 5. Services start on the host as today and are reached through `host.docker.internal`

`ensureServices` does not change: the compose stack `handoff-<id8>` starts on the host once per project, or another stack's services are used. The ports to forward are the published ports of the compose file's services, read with `docker compose -f <file> config --format json`, minus `H`. The preview container gets `--add-host host.docker.internal:host-gateway`, which Linux needs and Docker Desktop accepts (E5).

Why forwarding and not rewriting `localhost` in environment values: handoff sees only the launch configuration's env and the `passEnv` values. The repository's own `.env` files and config code also hold `localhost` URLs, and handoff cannot rewrite those. With the forwarder the app, the seed command and the Demo's browser see the same `localhost` ports the host sees.

Why not a per-project Docker network: on this machine new networks already fail for lack of address pools (E6), and attaching the preview container to a compose network would also bypass an egress-restricted `HANDOFF_DOCKER_NETWORK`. The same `host.docker.internal` route covers handoff's stack, another stack of the repository (#272) and a service the person runs natively.

On Linux a host service bound to `127.0.0.1` is not reachable through `host-gateway`. After the preview container starts, handoff opens one connection from inside it to `host.docker.internal:<P>` for each forwarded port; when one fails, the services step fails, naming the port and saying to publish it on all addresses or to use worktree mode (open question 1).

### 6. Stopping removes the container

`stopPreview` for a row with a container runs `docker exec <container> kill -TERM -1`, waits up to the same 5 seconds for the app's processes to end, then `docker rm -f`, and stops the host-side client's process group as today. The row is inserted before `docker run`, with the container name already known, so a crash between the two leaves a row that cleanup finds.

### 7. Cleanup after a worker restart covers dead workers, by row and by label

At start a worker stops every `starting` or `running` preview whose worker is not live (`liveWorkers`), not only its own id. This also fixes worktree mode, where the default worker id changes with the pid. Then it lists containers with the label `handoff.preview` and removes those whose row is not `starting` or `running`. Preview containers carry `handoff.preview=<id>`, `handoff.run=<runId>` and `handoff.worker=<workerId>`.

### 8. The Demo's Claude runs in the app's container

In Docker mode the Demo step runs its agent with `container` set to the preview container instead of the run's. The Playwright MCP server, which Claude starts, then runs where `http://localhost:H` is the app, on Docker Desktop and on Linux. From the run's container the browser would need `host.docker.internal:H`, which changes the origin, and on Linux does not reach a port published on `127.0.0.1`. The staging folder and Claude's config folder are under `HANDOFF_HOME`, so screenshots land where the host copies them from (`demo.ts:143-158`).

The runner image gains the browser `@playwright/mcp@0.0.83` drives and its system libraries, and the worker passes that browser's name as `browser` in Docker mode.

### 9. Test start makes containers too

In Docker mode `launchTestDeps` makes a `DockerWorkdirProvider` with the same options as the worker, so the setup command runs in `handoff-<testId>` and the app in its sibling, as in a run. The options move into one engine function, `dockerOptionsFromEnv`, which the worker and the dashboard both call. `launch_tests` gets a `container` column. The timer, `stopsAt` and stopping the previous Test start stay; stopping removes the preview container, then `release` removes the setup container and the worktree.

### 10. Secrets stay out of the graph, the database and argv

Variables the app needs from the worker's environment pass by name, as `passEnv` does today: `docker exec -e NAME` reads the value from the client's environment (`checks.ts:48`). Container labels hold ids only. The launch configuration's env stays plain text with its no-secrets rule.

### 11. Docker Engine 28 or later

Before 28.0.0, ports published on localhost may be reachable from the same L2 segment (Docker docs, above). In Docker mode the worker reads the server version at start and logs a warning below 28; the readiness check and App launch show the same warning.

## Design

### Data model

- `previews.container` text, null in worktree mode.
- `launch_tests.container` text.
- One migration through `pnpm db:generate`.

### Engine

```
packages/engine/src/
  workdir/docker-options.ts     dockerOptionsFromEnv(env): image, mounts, network, user; used by the worker and the dashboard
  preview/container.ts          siblingOf(runContainer, exec), startPreviewContainer(spec, ports, exec), probeInside(container, port), removePreviewContainer(name, exec)
  preview/forward.ts            the forwarder script's text and servicePorts(composeConfigJson, appPort)
  preview/ready.ts              answers(port, timeoutMs): any bytes back through 127.0.0.1
  preview/preview.ts            launchApp and startPreview gain the container branch; stopPreview removes containers; stopDeadWorkerPreviews
```

`launchApp` takes an optional `container: { of: string }` (the run's container). With it: services as today, the preview container (Decisions 1 to 3, 5), the seed command inside it, the app through `docker exec`, readiness by `answers` and the inside probe (Decision 4). `LaunchedApp` gains `container`. `startPreview` drops the refusal at `preview.ts:325`, inserts the row before the container starts, and records `container`. `DockerExec` stays the seam for every short `docker` call; the long-running `docker exec` of the app is spawned like today's app.

### Worker

`apps/worker/src/app.ts` builds the Docker options with `dockerOptionsFromEnv`, passes `browser` to the demo executor in Docker mode, and logs the Engine version warning. `startWorker` calls the dead-worker cleanup instead of `stopWorkerPreviews(deps.workerId)`.

### Web

- `apps/web/src/server/app-launch.ts`: `launchTestDeps` uses `DockerWorkdirProvider` in Docker mode; `AppLaunchView.docker` stays and drives the copy below.
- `launch-actions.ts`: the refusal at `:65` goes; `DOCKER_NOT_SUPPORTED` is removed.
- Try it: `PreviewState` gains `container` when there is one, and the gate checks a running row's container with `docker inspect` before returning it, so "Start the app again" starts a stopped one.
- Readiness: `launchCheck` in Docker mode adds the 0.0.0.0 note.

### What the pages say in Docker mode

The ids, ports and commands in these sentences are examples; the pages fill in the real ones.

App launch, in place of today's alert, an info line: "Steps run in Docker containers from handoff-runner:2.1.285. The app runs in its own container from that image, published on 127.0.0.1 only, and must listen on 0.0.0.0. It reaches the services in compose.yaml at the same localhost ports as on this machine." The image comes from `HANDOFF_DOCKER_IMAGE` and the compose file from the default branch; without a compose file the last sentence is left out. Test start shows again, with step details such as "`pnpm install --frozen-lockfile` exited 0 in container handoff-1a2b3c4d" and "Listening on port 41234 in container handoff-preview-5e6f7a8b". With an Engine below 28, the warning from Decision 11.

Try it gate: "Open the app" with the URL as today, and under it a muted line such as "Runs in Docker container handoff-preview-5e6f7a8b, reachable from this machine only." A failure shows the message from Decision 4 or 5 in the existing terminal block.

Readiness, "The app starts": "The app gets a free port in PORT and runs in its own container; it must listen on 0.0.0.0."

## Delivery

Each PR is one GitHub issue, one branch, CI green, a red-green slice per test named here, `pnpm doctor:react` clean after changes under `apps/web`, and Context7 before code against Drizzle, Vitest, Zod or Next.js. Docker tests are guarded by `HANDOFF_TEST_DOCKER=1` and use `node:22-alpine`, as `docker.integration.test.ts` does, so CI runs them on Linux. PR 2 needs 1; 3 needs 1 and 2; 4 needs 3; 5 needs 3; 6 needs 3; 7 needs 5 and 6; 8 needs 7.

1. **Shared Docker options and the preview container.** Files: `workdir/docker-options.ts`, `preview/container.ts`, `apps/worker/src/app.ts`, `apps/worker/src/env.ts`. First tests: `docker-options.test.ts` "Docker options come from HANDOFF_DOCKER_IMAGE, HANDOFF_HOME with HANDOFF_DOCKER_MOUNTS, and HANDOFF_DOCKER_NETWORK, as the worker read them". `container.integration.test.ts` (Docker) "a preview container copies the run container's image, mounts, user and network"; "its port is published on 127.0.0.1 and reaches an app that listens on 0.0.0.0"; "a host port taken between the check and docker run is retried with another and leaves no Created container"; "removing it ends every process started in it with docker exec".

2. **Service ports inside the container.** Files: `preview/forward.ts`, `preview/container.ts`. First tests: `forward.test.ts` "the forwarded ports are the compose file's published ports, without the app's port"; "a compose file without published ports forwards nothing". `container.integration.test.ts` (Docker) "a command in the preview container reaches a host service at localhost on the service's port"; "a port the forwarder cannot reach fails the services step and names the port".

3. **startPreview in Docker workspaces.** Files: `preview/preview.ts`, `preview/ready.ts`, `packages/db/src/schema/previews.ts` and the migration, `executors/human-gate.ts`. First tests: `ready.test.ts` (no Docker) "a server that accepts and closes without a byte is not ready"; "a server that answers anything is ready". `preview.integration.test.ts` (Docker) "a run's app starts in a container next to the run's on a free port and answers at localhost from the host"; "an app that listens only on 127.0.0.1 inside its container fails and says to listen on 0.0.0.0"; "an app that never listens fails and says to read PORT"; "an app that exits before it is up fails with the end of its output"; "the seed command runs in the app's container"; "an app that must have its port fails when the port is taken"; "stopPreview removes the app's container"; "cancelling a run removes its app's container". `human-gate` addition "Start the app again starts a new container when the old one is gone".

4. **Cleanup after a restart.** Files: `preview/preview.ts`, `scheduler/worker.ts`. First tests: `preview.integration.test.ts` "a starting worker stops the previews of workers that are no longer live, whatever their id"; "it leaves a live worker's previews alone"; (Docker) "a preview container whose row is not running is removed when a worker starts".

5. **Demo in Docker workspaces.** Files: `executors/demo.ts`, `docker/runner.Dockerfile`, `apps/worker/src/app.ts`. First tests: `demo.integration.test.ts` (Docker, fake claude) "the demo's Claude runs in the app's container, where the app's URL answers". Manual step recorded on the PR: `pnpm docker:runner`, the image size before and after, and a demo of todooverkill's app taking screenshots in Docker mode.

6. **Test start in Docker workspaces.** Files: `preview/launch-test.ts`, `packages/db/src/schema/launch-tests.ts` and the migration, `apps/web/src/server/app-launch.ts`, `apps/web/src/app/projects/launch-actions.ts`. First tests: `launch-test.integration.test.ts` (Docker) "Test start in a Docker workspace runs setup in a container and the app in its sibling, at localhost"; "a Test start past its 10 minutes removes both containers and the worktree"; "a new Test start removes the previous one's containers". `app-launch.test.ts` "Docker workspace mode makes Test start's worktree with containers".

7. **What the pages say.** Files: `components/projects/app-launch-settings.tsx`, `lib/app-launch.ts`, `components/review/try-review.tsx`, `server/try-review.ts`, `server/readiness.ts`. First tests (web): `app-launch-settings.test.tsx` "in Docker workspace mode the section offers Test start and says the app runs in its own container on 127.0.0.1"; "an Engine below 28 shows the warning". `try-review.test.tsx` "a Docker app says which container runs it and that only this machine reaches it". `readiness.test.ts` "in Docker mode the launch check says the app must listen on 0.0.0.0".

8. **Docs.** README "Running each run in a container": the app's container, loopback publishing, services through `host.docker.internal`, the Linux note, Engine 28. `GLOSSARY.md` App launch: Docker mode in one sentence. ADR 0009 "A run's app runs in a sibling container". Close #264.

## Risks

| Risk | Mitigation |
|---|---|
| A dev server binds 127.0.0.1 inside the container and looks unreachable | `HOST=0.0.0.0`, and the failure says the app listens on loopback only and what to change (Decision 4). |
| Docker Desktop's port proxy accepts connections before the app listens (E1) | Readiness needs bytes back (Decision 4). |
| A host port is taken between `portFor` and `docker run` | Three tries with new ports; the Created container is removed (E8). |
| The app is reachable from the network | Loopback publishing only; the Engine 28 warning (Decision 11). |
| A service bound to 127.0.0.1 on a Linux host is unreachable from the container | The services step names the port and the fix; open question 1. |
| An egress-restricted or internal `HANDOFF_DOCKER_NETWORK` blocks publishing or `host.docker.internal` | The preview container joins the run's network as the run's own does; the failure quotes Docker's message. Recorded as unverified. |
| Preview containers outlive a crashed worker | Row before container, dead-worker cleanup and the label sweep (Decisions 6 and 7). |
| The runner image grows with a browser | Measured in PR 5; open question 6. |
| Docker Desktop has no address pools left for new networks (E6) | No new networks are created. |
| `tsx watch` restarts the worker during development and leaves containers | The label sweep at start removes them; run the worker from a separate worktree during real runs. |
| The dashboard's Test start and the worker both run `docker` | Both read the same options from `dockerOptionsFromEnv` and the same `.env`. |

## Open questions

Each has a recommended answer; unanswered, the implementation takes the recommendation.

1. On Linux, should handoff reach services bound to `127.0.0.1` on the host by attaching the preview container to the service container's network? Recommended: not now. Compose's `"5432:5432"` binds all addresses, Docker Desktop reaches loopback services anyway (E4), and the attachment would bypass a restricted `HANDOFF_DOCKER_NETWORK`. The failure names the port and the fix.
2. Should the preview container join `HANDOFF_DOCKER_NETWORK`? Recommended: yes, the same network as the run's container. The app is agent-written code like the rest of the run.
3. Publish on `[::1]` too? Recommended: yes, with the fallback to `127.0.0.1` only when Docker refuses it.
4. Readiness from the host by answer, or by a TCP probe inside the container? Recommended: by answer from the host, which tests the person's path, with the inside probe only to explain a failure.
5. Stop with SIGTERM and a grace period, or `docker rm -f` at once? Recommended: SIGTERM to every process, 5 seconds, then `docker rm -f`, matching worktree mode.
6. Put a browser in the runner image, or skip Demo steps in Docker mode? Recommended: the browser in the image, since Try it shows the demo's screenshots and warnings.
7. Test start with a setup container and an app container, or one container for both? Recommended: two, the same as a run, so a Test start that works predicts a run that works.
8. Should a worker below Engine 28 refuse to start previews? Recommended: no, warn. The person decides.
9. Should the dead-worker cleanup apply to worktree mode too? Recommended: yes; the default worker id changes on every restart, so today's cleanup misses them.

## Verification

Tests and checks:

```bash
pnpm db:migrate        # in the main checkout; never pnpm db:up in a worktree
pnpm docker:runner
HANDOFF_TEST_DOCKER=1 pnpm test
pnpm typecheck && pnpm lint
pnpm doctor:react
```

By hand on macOS with Docker Desktop, todooverkill, `HANDOFF_WORKSPACE=docker` in `.env`, `pnpm dev:web`, and `pnpm dev:worker` from a separate worktree:

1. Project settings, App launch: expect the Docker info line and Test start. Press Test start: expect the setup step in `handoff-<id8>`, the services step with `handoff-6c588fd7`, the app step in `handoff-preview-<id8>`, and Open the app at `http://localhost:<port>`.
2. From another machine on the same network, open `http://<this machine's address>:<port>`: expect no answer. `docker port handoff-preview-<id8>`: expect only `127.0.0.1` and `[::1]`.
3. Wait 10 minutes: expect Stopped, and `docker ps -a --filter label=handoff.preview` empty.
4. Run a task through a graph with Demo and Try it: expect screenshots from the Demo, Open the app on the Try it page, and the app reading todooverkill's database through `localhost:5432`.
5. Stop the worker while the Try it app runs and start it again: expect the preview container removed and the row stopped; "Start the app again" starts a new one.
6. Cancel a run with a running app: expect its preview container and run container gone.
7. Change the launch command to listen on `127.0.0.1` only and press Test start: expect the loopback message from Decision 4.
