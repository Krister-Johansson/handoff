import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { ClaudeCliExecutor } from "@handoff/cli-adapter";
import { fakeClaude, fakeClaudeBin, lines, SESSION_ID } from "@handoff/cli-adapter/testing";
import { shell } from "../contract/checks.ts";
import { createOriginRepo } from "../testing/git.ts";
import { DockerWorkdirProvider } from "./docker.ts";
import { GitWorktreeProvider } from "./git-worktree.ts";

const enabled = process.env.HANDOFF_TEST_DOCKER === "1";
const image = process.env.HANDOFF_TEST_DOCKER_IMAGE ?? "node:22-alpine";
const repoRoot = resolve(import.meta.dirname, "../../../..");

function provider() {
  const home = mkdtempSync(join(tmpdir(), "handoff-docker-home-"));
  const docker = new DockerWorkdirProvider({ git: new GitWorktreeProvider({ root: home }), image, mounts: [home, repoRoot, tmpdir()] });
  const spec = { runId: `t${Date.now()}`, remoteUrl: createOriginRepo(), baseBranch: "main", branchName: "handoff/docker" };
  return { docker, spec, home };
}

describe.skipIf(!enabled)("DockerWorkdirProvider", () => {
  test("DockerWorkdirProvider runs a command inside the container and reads its output", async () => {
    const { docker, spec } = provider();
    const workdir = await docker.acquire(spec);
    try {
      expect(workdir.container).toMatch(/^handoff-/);
      const result = await shell("cat /etc/os-release | head -1; test -f README.md && echo has-readme; pwd", workdir.path, 30_000, workdir.container);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Alpine");
      expect(result.output).toContain("has-readme");
      expect(result.output).toContain(workdir.path);
    } finally {
      await docker.release(spec);
    }
  });

  test("DockerWorkdirProvider passes only the named variables into the container", async () => {
    const { docker, spec } = provider();
    const workdir = await docker.acquire(spec);
    process.env.APP_TEST_DB = "postgres://db/app_test";
    try {
      const result = await shell('echo "[$APP_TEST_DB][$CI]"', workdir.path, 30_000, workdir.container, ["APP_TEST_DB"]);
      expect(result.output).toBe("[postgres://db/app_test][true]");
    } finally {
      delete process.env.APP_TEST_DB;
      await docker.release(spec);
    }
  });

  test("acquire reuses the running container for the same run", async () => {
    const { docker, spec } = provider();
    const first = await docker.acquire(spec);
    const second = await docker.acquire(spec);
    expect(second.container).toBe(first.container);
    await docker.release(spec);
  });

  test("release removes the container and the worktree", async () => {
    const { docker, spec } = provider();
    const workdir = await docker.acquire(spec);
    await docker.release(spec);
    const running = execFileSync("docker", ["ps", "-a", "--filter", `name=${workdir.container}`, "--format", "{{.Names}}"]).toString().trim();
    expect(running).toBe("");
    expect(existsSync(workdir.path)).toBe(false);
  });

  test("the Claude CLI executor runs inside the container with the same paths", async () => {
    const { docker, spec, home } = provider();
    const workdir = await docker.acquire(spec);
    try {
      const fake = fakeClaude({ edits: [{ path: "from-container.txt", content: "hi" }], lines: [lines.init(), lines.result({ structured_output: { ok: true } })] }, mkdtempSync(join(home, "fake-")));
      const executor = new ClaudeCliExecutor({
        command: { file: "node", prefixArgs: [fakeClaudeBin] },
        oauthToken: "sk-ant-oat01-test",
        configDir: join(home, "claude-config"),
        baseEnv: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/root", ...fake.env },
        passthroughEnv: ["FAKE_CLAUDE_SCENARIO", "FAKE_CLAUDE_RECORD"],
        killGraceMs: 200,
      });
      const stagingDir = mkdtempSync(join(home, "stage-"));
      const result = await executor.run(
        {
          prompt: "go",
          systemPrompt: "# Task",
          cwd: workdir.path,
          stagingDir,
          allowedTools: ["Read"],
          maxTurns: 5,
          contract: z.object({ ok: z.boolean() }),
          addDirs: [],
          session: { mode: "new", id: SESSION_ID, name: "docker-test" },
          timeoutMs: 30_000,
          container: workdir.container!,
        },
        { signal: new AbortController().signal, onEvent: () => {} },
      );
      expect(result.outcome).toBe("success");
      expect(readFileSync(join(workdir.path, "from-container.txt"), "utf8")).toBe("hi");
      const [invocation] = fake.invocations();
      expect(invocation?.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-test");
      expect(invocation?.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    } finally {
      await docker.release(spec);
    }
  });
});
