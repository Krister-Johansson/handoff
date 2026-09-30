import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type Proc = { pid: number; ppid: number; command: string };

async function processes(): Promise<Proc[]> {
  try {
    const { stdout } = await execFileAsync("ps", ["-A", "-ww", "-o", "pid=,ppid=,command="], { maxBuffer: 16 * 1024 * 1024 });
    return stdout.split("\n").flatMap((line) => {
      const m = /^\s*(\d+)\s+(\d+)\s(.*)$/.exec(line);
      return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), command: m[3]!.trim() }] : [];
    });
  } catch {
    return [];
  }
}

const signal = (pid: number, sig: NodeJS.Signals) => {
  try {
    process.kill(pid, sig);
  } catch {
    // already gone
  }
};

/**
 * Watches the processes started under `root` while it runs, so that the ones it leaves behind (a dev
 * server started with `&`, even in its own session) can be stopped once it exits. A process is only
 * stopped while it still has the command it had when it was seen, so a reused pid is left alone.
 */
export function trackDescendants(root: number, intervalMs = 1_000) {
  const seen = new Map<number, string>();
  const poll = async () => {
    const all = await processes();
    const children = new Map<number, Proc[]>();
    for (const p of all) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p]);
    const queue = [...(children.get(root) ?? [])];
    while (queue.length) {
      const p = queue.shift()!;
      if (!seen.has(p.pid)) seen.set(p.pid, p.command);
      queue.push(...(children.get(p.pid) ?? []));
    }
  };
  void poll();
  const timer = setInterval(() => void poll(), intervalMs);
  timer.unref();

  return {
    /** Stops the root's process group and every process seen under it that is still running. */
    async stop(graceMs = 2_000) {
      clearInterval(timer);
      await poll();
      signal(-root, "SIGTERM");
      const left = async () => {
        const now = new Map((await processes()).map((p) => [p.pid, p.command]));
        return [...seen].filter(([pid, command]) => now.get(pid) === command).map(([pid]) => pid);
      };
      const running = await left();
      if (running.length === 0) return;
      for (const pid of running) signal(pid, "SIGTERM");
      await new Promise((r) => setTimeout(r, Math.min(graceMs, 500)));
      for (const pid of await left()) signal(pid, "SIGKILL");
    },
  };
}
