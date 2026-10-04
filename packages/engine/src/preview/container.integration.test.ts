import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, onTestFinished, test } from "vitest";
import { createOriginRepo } from "../testing/git.ts";
import { DockerWorkdirProvider } from "../workdir/docker.ts";
import { GitWorktreeProvider } from "../workdir/git-worktree.ts";
import { previewContainerName, removePreviewContainer, siblingOf, startPreviewContainer } from "./container.ts";

const enabled = process.env.HANDOFF_TEST_DOCKER === "1";
const image = process.env.HANDOFF_TEST_DOCKER_IMAGE ?? "node:22-alpine";

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const inspect = (name: string) => JSON.parse(docker("inspect", name))[0];
const containersLabelled = (previewId: string) => docker("ps", "-a", "--filter", `label=handoff.preview=${previewId}`, "--format", "{{.State}}").split("\n").filter(Boolean);

/** A port nothing on the host listens on, as portFor picks it. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** A run's container from DockerWorkdirProvider, removed with its worktree when the test ends. */
async function runContainer() {
  const home = mkdtempSync(join(tmpdir(), "handoff-preview-home-"));
  const provider = new DockerWorkdirProvider({ git: new GitWorktreeProvider({ root: home }), image, mounts: [home, tmpdir()] });
  const spec = { runId: `t${Date.now()}${Math.floor(Math.random() * 1000)}`, remoteUrl: createOriginRepo(), baseBranch: "main", branchName: "handoff/preview" };
  const workdir = await provider.acquire(spec);
  onTestFinished(() => provider.release(spec));
  return { name: workdir.container!, path: workdir.path, runId: spec.runId };
}

/** A preview container next to `run`, removed when the test ends whatever the test did with it. */
async function previewNextTo(run: { name: string; runId: string }, ports: { first: number; next?: () => Promise<number> }) {
  const previewId = randomUUID();
  onTestFinished(() => {
    execFileSync("docker", ["rm", "-f", previewContainerName(previewId)], { stdio: "ignore" });
  });
  const started = await startPreviewContainer({ previewId, runId: run.runId, workerId: "worker-test", of: await siblingOf(run.name) }, ports);
  return { previewId, ...started };
}

async function answer(url: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await (await fetch(url, { signal: AbortSignal.timeout(1_000) })).text();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await sleep(200);
    }
  }
}

describe.skipIf(!enabled)("preview container", () => {
  test("a preview container copies the run container's image, mounts, user and network", async () => {
    const run = await runContainer();
    const preview = await previewNextTo(run, { first: await freePort() });
    const [runs, previews] = [inspect(run.name), inspect(preview.name)];
    expect(preview.name).toBe(previewContainerName(preview.previewId));
    expect(previews.Config.Image).toBe(runs.Config.Image);
    // Docker reports mounts in no fixed order.
    expect([...previews.HostConfig.Binds].sort()).toEqual([...runs.HostConfig.Binds].sort());
    expect(previews.HostConfig.Binds).toContain(`${run.path}:${run.path}`);
    expect(previews.Config.User).toBe(runs.Config.User);
    expect(previews.Config.User).toBe(`${process.getuid!()}:${process.getgid!()}`);
    expect(previews.HostConfig.NetworkMode).toBe(runs.HostConfig.NetworkMode);
    expect(previews.Config.WorkingDir).toBe(run.path);
    expect(previews.Config.Env).toEqual(expect.arrayContaining(runs.Config.Env));
    expect(previews.Config.Labels).toMatchObject({ "handoff.preview": preview.previewId, "handoff.run": run.runId, "handoff.worker": "worker-test" });
    expect(previews.State.Running).toBe(true);
  });

  test("its port is published on 127.0.0.1 and reaches an app that listens on 0.0.0.0", async () => {
    const run = await runContainer();
    const port = await freePort();
    const preview = await previewNextTo(run, { first: port });
    expect(preview.port).toBe(port);
    docker("exec", "-d", preview.name, "node", "-e", `require("http").createServer((q, s) => s.end("from the container")).listen(${port}, "0.0.0.0")`);
    expect(await answer(`http://127.0.0.1:${port}/`)).toBe("from the container");
    if (preview.addresses.includes("::1")) expect(await answer(`http://[::1]:${port}/`)).toBe("from the container");
    const published = docker("port", preview.name).split("\n");
    expect(published.length).toBe(preview.addresses.length);
    for (const line of published) expect(line).toMatch(new RegExp(`^${port}/tcp -> (127\\.0\\.0\\.1|\\[::1\\]):${port}$`));
  });

  test("a host port taken between the check and docker run is retried with another and leaves no Created container", async () => {
    const run = await runContainer();
    const taken = await freePort();
    const holder: Server = createServer();
    await new Promise<void>((resolve) => holder.listen(taken, "127.0.0.1", resolve));
    onTestFinished(() => new Promise<void>((resolve) => holder.close(() => resolve())));
    const preview = await previewNextTo(run, { first: taken, next: freePort });
    expect(preview.port).not.toBe(taken);
    expect(containersLabelled(preview.previewId)).toEqual(["running"]);
    expect(docker("port", preview.name)).toContain(`127.0.0.1:${preview.port}`);
  });

  test("removing it ends every process started in it with docker exec", async () => {
    const run = await runContainer();
    const preview = await previewNextTo(run, { first: await freePort() });
    const marker = join(run.path, "stopped-by");
    // The app as the preview will start it: a host-side docker exec client, here with a child of its own.
    const app = spawn("docker", ["exec", preview.name, "sh", "-c", `sleep 300 & trap 'echo SIGTERM > ${marker}; exit 0' TERM; while true; do sleep 0.2; done`], { stdio: "ignore" });
    const exited = new Promise<number | null>((resolve) => app.once("exit", (code) => resolve(code)));
    docker("exec", "-d", preview.name, "sleep", "300");
    await sleep(500);
    expect(Number(docker("exec", preview.name, "sh", "-c", "ls -d /proc/[0-9]* | wc -l"))).toBeGreaterThan(4);

    await removePreviewContainer(preview.name);

    expect(existsSync(marker) && readFileSync(marker, "utf8").trim()).toBe("SIGTERM");
    expect(await exited).toBe(0);
    expect(containersLabelled(preview.previewId)).toEqual([]);
  });
});
