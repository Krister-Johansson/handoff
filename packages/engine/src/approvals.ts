import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type { ExecutorContext } from "./types.ts";

const execFileAsync = promisify(execFile);

/** What a node approved: the fingerprint of the run's own change then, when, by whom, and at which commit. */
export type Approval = { fingerprint: string; at: string; head?: string; by?: string };

const approvalsOf = (ctx: ExecutorContext): Record<string, Approval> => {
  const approvals = ctx.state.approvals;
  return approvals && typeof approvals === "object" ? (approvals as Record<string, Approval>) : {};
};

/** Where the run's code is for this step: its own worktree, or the run's while a gate that needs none reads it. */
const codeOf = (ctx: ExecutorContext) => ctx.workdir?.path ?? ctx.run.worktreePath ?? undefined;

async function headOf(cwd: string): Promise<string | undefined> {
  try {
    return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The run's state patch that records this node's approval of the change as it is now, or undefined
 * when the change cannot be read or is empty.
 */
export async function recordApproval(ctx: ExecutorContext, approval: { at: string; by?: string }): Promise<Record<string, unknown> | undefined> {
  const cwd = codeOf(ctx);
  const fingerprint = cwd ? await ownDiffFingerprint(cwd, `origin/${ctx.run.baseBranch}`) : undefined;
  if (!cwd || !fingerprint) return undefined;
  const head = await headOf(cwd);
  const entry: Approval = { fingerprint, at: approval.at, ...(head ? { head } : {}), ...(approval.by ? { by: approval.by } : {}) };
  return { approvals: { ...approvalsOf(ctx), [ctx.node.key]: entry } };
}

/** Whether the node's latest result is an approval: a gate's last answer, or a code review's last verdict. */
function lastApproved(ctx: ExecutorContext): boolean {
  if (ctx.node.type === "human_gate") return ctx.state.human[ctx.node.key]?.approved === true;
  return (ctx.state.nodes[ctx.node.key]?.output as { verdict?: unknown } | undefined)?.verdict === "approve";
}

const when = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/**
 * The node's last approval when the run's own change is the same as it was then, with the message the
 * event log shows; undefined when the node must run as before. Records the `approval.held` event.
 */
export async function heldApproval(ctx: ExecutorContext): Promise<{ approval: Approval; message: string } | undefined> {
  const approval = approvalsOf(ctx)[ctx.node.key];
  const cwd = codeOf(ctx);
  if (!approval || !cwd || !lastApproved(ctx)) return undefined;
  const base = ctx.run.baseBranch;
  if ((await ownDiffFingerprint(cwd, `origin/${base}`)) !== approval.fingerprint) return undefined;
  const head = await headOf(cwd);
  const message = head && approval.head && head !== approval.head ? `Unchanged since your approval at ${when(approval.at)}; only ${base} was merged in` : `Unchanged since your approval at ${when(approval.at)}`;
  ctx.emit("approval.held", { message, approvedAt: approval.at, ...(approval.by ? { approvedBy: approval.by } : {}), base, fingerprint: approval.fingerprint });
  return { approval, message };
}

/**
 * The run's own change in `diff -U0` output, per file: its added and removed lines, sorted, plus the
 * header lines that say a file was created, deleted, changed mode or is binary. Hunk headers, line
 * numbers and context lines are left out, so where the lines sit does not matter, only what they are.
 */
function ownLines(diff: string): [string, string[]][] {
  const files: { path: string; lines: string[]; index?: string }[] = [];
  let current: (typeof files)[number] | undefined;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/.* b\/(.*)$/.exec(line);
    if (header) {
      current = { path: header[1]!, lines: [] };
      files.push(current);
      inHunk = false;
    } else if (!current) continue;
    else if (line.startsWith("@@")) inHunk = true;
    else if (inHunk) {
      if (line.startsWith("+") || line.startsWith("-")) current.lines.push(line);
    } else if (line.startsWith("index ")) current.index = line;
    else if (/^(new file mode|deleted file mode|old mode|new mode)/.test(line)) current.lines.push(line);
    else if (line.startsWith("Binary files")) {
      // A binary file has no lines to compare: its blob ids stand for its content. A text file's blob ids
      // change with every line of the file, the base's included, so they are left out.
      current.lines.push(line, current.index ?? "");
    }
  }
  return files.map((f) => [f.path, f.lines.sort()] as [string, string[]]).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * A hash of the branch's own change against `base`: for each file in `git diff -U0 <merge-base>..HEAD`,
 * its sorted added and removed lines. A merge of the base that leaves the run's own lines as they were
 * keeps it; a change to those lines changes it. Undefined when git fails or the branch changes nothing,
 * since an approval of no change holds nothing.
 */
export async function ownDiffFingerprint(workdir: string, base: string): Promise<string | undefined> {
  const git = async (args: string[]) =>
    (await execFileAsync("git", args, { cwd: workdir, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })).stdout;
  try {
    const mergeBase = (await git(["merge-base", base, "HEAD"])).trim();
    const diff = await git(["diff", "--no-color", "--no-ext-diff", "--no-renames", "--full-index", "-U0", mergeBase, "HEAD"]);
    const files = ownLines(diff);
    if (files.length === 0) return undefined;
    return createHash("sha256").update(JSON.stringify(files)).digest("hex");
  } catch {
    return undefined;
  }
}
