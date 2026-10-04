import { expect, test } from "vitest";
import type { DockerExec } from "./preview.ts";
import { siblingOf, startPreviewContainer, type SiblingConfig } from "./container.ts";

const of: SiblingConfig = { image: "runner:1", user: "501:20", env: ["HOME=/tmp"], binds: ["/h:/h"], workdir: "/h/worktrees/r1" };
const spec = { previewId: "5e6f7a8b-0000-0000-0000-000000000000", runId: "r1", of };

/** A fake docker that answers `docker run` with the given outputs in turn, failing while one is given, and records every call. */
function fakeDocker(runFailures: string[]) {
  const calls: string[][] = [];
  const exec: DockerExec = async (args) => {
    calls.push(args);
    if (args[0] === "run") {
      const failure = runFailures.shift();
      if (failure) return { exitCode: 125, output: failure };
    }
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
