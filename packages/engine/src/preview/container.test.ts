import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { DockerExec } from "./preview.ts";
import { mountedPath, reachServices, siblingOf, startPreviewContainer, type SiblingConfig } from "./container.ts";
import { FORWARDER_READY, forwarderScript } from "./forward.ts";

const of: SiblingConfig = { image: "runner:1", user: "501:20", env: ["HOME=/tmp"], binds: ["/h:/h"], workdir: "/h/worktrees/r1" };
const dir = mkdtempSync(join(tmpdir(), "handoff-forward-"));
const spec = { previewId: "5e6f7a8b-0000-0000-0000-000000000000", runId: "r1", of, forward: { ports: [], dir } };

/**
 * A fake docker that answers `docker run` with the given outputs in turn, failing while one is given,
 * answers `docker logs` with `logs` (the forwarder's ready line unless given), and records every call.
 */
function fakeDocker(runFailures: string[], logs = FORWARDER_READY) {
  const calls: string[][] = [];
  const exec: DockerExec = async (args) => {
    calls.push(args);
    if (args[0] === "run") {
      const failure = runFailures.shift();
      if (failure) return { exitCode: 125, output: failure };
    }
    if (args[0] === "logs") return { exitCode: 0, output: `${logs}\n` };
    return { exitCode: 0, output: "" };
  };
  const published = () => calls.filter((c) => c[0] === "run").map((c) => c.flatMap((a, i) => (c[i - 1] === "-p" ? [a] : [])));
  return { exec, calls, published };
}

test("a Docker that refuses [::1] publishes the app's port on 127.0.0.1 only", async () => {
  const docker = fakeDocker(["docker: Error response from daemon: driver failed programming external connectivity: Error starting userland proxy: listen tcp6 [::1]:41234: socket: address family not supported by protocol."]);
  const started = await startPreviewContainer(spec, { first: 41234 }, docker.exec);
  expect(started).toEqual({ name: "handoff-preview-5e6f7a8b", port: 41234, addresses: ["127.0.0.1"] });
  expect(docker.published()).toEqual([["127.0.0.1:41234:41234", "[::1]:41234:41234"], ["127.0.0.1:41234:41234"]]);
  expect(docker.calls).toContainEqual(["rm", "-f", "handoff-preview-5e6f7a8b"]);
});

test("an app that must keep its port fails once the port is taken, without another try", async () => {
  const docker = fakeDocker(["Bind for 127.0.0.1:3000 failed: port is already allocated"]);
  await expect(startPreviewContainer(spec, { first: 3000 }, docker.exec)).rejects.toThrow(/port 3000 is in use/i);
  expect(docker.published()).toHaveLength(1);
  expect(docker.calls.at(-1)).toEqual(["rm", "-f", "handoff-preview-5e6f7a8b"]);
});

test("a free port taken again and again fails after three new ports", async () => {
  const taken = "listen tcp4 127.0.0.1:1: bind: address already in use";
  const docker = fakeDocker([taken, taken, taken, taken]);
  let next = 50_000;
  await expect(startPreviewContainer(spec, { first: 41234, next: async () => next++ }, docker.exec)).rejects.toThrow(/in use/);
  expect(docker.published().map((p) => p[0])).toEqual(["127.0.0.1:41234:41234", "127.0.0.1:50000:50000", "127.0.0.1:50001:50001", "127.0.0.1:50002:50002"]);
});

test("any other docker run failure quotes Docker and removes the Created container", async () => {
  const docker = fakeDocker(["Unable to find image 'runner:1' locally"]);
  await expect(startPreviewContainer(spec, { first: 41234 }, docker.exec)).rejects.toThrow(/did not start[\s\S]*Unable to find image/);
  expect(docker.calls.at(-1)).toEqual(["rm", "-f", "handoff-preview-5e6f7a8b"]);
});

test("the sibling joins the run container's network and keeps its user, env, mounts and workdir", async () => {
  const inspect = [{ Config: { Image: "runner:1", User: "501:20", Env: ["HOME=/tmp", "PATH=/bin"], WorkingDir: "/w" }, HostConfig: { Binds: ["/h:/h", "/w:/w"], NetworkMode: "egress" } }];
  const sibling = await siblingOf("handoff-r1", async () => ({ exitCode: 0, output: JSON.stringify(inspect) }));
  expect(sibling).toEqual({ image: "runner:1", user: "501:20", env: ["HOME=/tmp", "PATH=/bin"], binds: ["/h:/h", "/w:/w"], network: "egress", workdir: "/w" });
  const docker = fakeDocker([]);
  await startPreviewContainer({ ...spec, of: sibling }, { first: 41234 }, docker.exec);
  const run = docker.calls.find((c) => c[0] === "run")!;
  expect(run.join(" ")).toContain("--network egress");
  expect(run.join(" ")).toContain("--user 501:20");
  expect(run.join(" ")).toContain("-v /w:/w");
  expect(run.join(" ")).toContain("-w /w runner:1");
});

test("a run container on Docker's default network gives a sibling without --network", async () => {
  const inspect = [{ Config: { Image: "runner:1", User: "", Env: null, WorkingDir: "/w" }, HostConfig: { Binds: null, NetworkMode: "default" } }];
  expect(await siblingOf("handoff-r1", async () => ({ exitCode: 0, output: JSON.stringify(inspect) }))).toEqual({ image: "runner:1", env: [], binds: [], workdir: "/w" });
});

test("a missing run container fails with Docker's message", async () => {
  await expect(siblingOf("handoff-gone", async () => ({ exitCode: 1, output: "Error: No such object: handoff-gone" }))).rejects.toThrow(/handoff-gone[\s\S]*No such object/);
});

test("the forwarder is the container's main process and forwards every service port but the app's", async () => {
  const docker = fakeDocker(["Bind for 127.0.0.1:41234 failed: port is already allocated"]);
  const started = await startPreviewContainer({ ...spec, forward: { ports: [5432, 6379, 50000], dir } }, { first: 41234, next: async () => 50000 }, docker.exec);
  expect(started.port).toBe(50000);
  const script = join(dir, "handoff-forward.mjs");
  expect(readFileSync(script, "utf8")).toBe(forwarderScript);
  const runs = docker.calls.filter((c) => c[0] === "run");
  expect(runs[0]!.join(" ")).toContain("--add-host host.docker.internal:host-gateway");
  expect(runs[0]!.slice(-6)).toEqual(["runner:1", "node", script, "5432", "6379", "50000"]);
  expect(runs[1]!.slice(-5)).toEqual(["runner:1", "node", script, "5432", "6379"]);
});

test("a forwarder that cannot listen removes the container and quotes it", async () => {
  const docker = fakeDocker([], "handoff-forward: cannot listen on 127.0.0.1:5432: listen EACCES");
  await expect(startPreviewContainer({ ...spec, forward: { ports: [5432], dir } }, { first: 41234 }, docker.exec)).rejects.toThrow(
    /did not start forwarding[\s\S]*127\.0\.0\.1:5432: listen EACCES/,
  );
  expect(docker.calls.at(-1)).toEqual(["rm", "-f", "handoff-preview-5e6f7a8b"]);
});

test("the services check names every port the container cannot reach", async () => {
  const exec: DockerExec = async () => ({ exitCode: 0, output: "5432 connect ECONNREFUSED 172.17.0.1:5432\n6379 timed out\n" });
  await expect(reachServices("handoff-preview-5e6f7a8b", [5432, 6379, 8025], exec)).rejects.toThrow(
    /could not reach ports 5432 and 6379 on this machine[\s\S]*"5432:5432"[\s\S]*ECONNREFUSED/,
  );
  await expect(reachServices("handoff-preview-5e6f7a8b", [5432], async () => ({ exitCode: 0, output: "" }))).resolves.toBeUndefined();
});

test("a host path is found in the container through the mount that holds it, by its own path or its real path", () => {
  const home = mkdtempSync(join(tmpdir(), "handoff-home-"));
  const real = realpathSync(home);
  const binds = ["/elsewhere:/elsewhere", `${home}:${home}`];
  expect(mountedPath(join(home, "repos/x/.git/worktrees/r1"), binds)).toBe(join(home, "repos/x/.git/worktrees/r1"));
  // git reports a worktree's git directory with symbolic links resolved, such as macOS's /var as /private/var.
  expect(mountedPath(join(real, "repos/x/.git/worktrees/r1"), binds)).toBe(join(home, "repos/x/.git/worktrees/r1"));
  expect(mountedPath("/not/mounted/.git", binds)).toBeUndefined();
  expect(mountedPath("/elsewhere-too/x", binds)).toBeUndefined();
});
