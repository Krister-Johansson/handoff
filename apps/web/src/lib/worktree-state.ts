/**
 * Whether a run's worktree can be opened in an editor, as the server works it out. Only `open` carries
 * a path to link to; `shown` is the folder for people to read, with the home folder shortened to ~.
 */
export type WorktreeState =
  | { state: "open"; path: string; shown: string; running: boolean }
  /** No step has needed a workdir yet. */
  | { state: "not-created" }
  /** The run succeeded or was cancelled, and handoff removed its worktree. */
  | { state: "released"; prNumber: number | null }
  /** A failed run whose worktree handoff gc removed. */
  | { state: "removed-by-gc" }
  /** A stored path that is not this run's folder under HANDOFF_HOME/worktrees, or is not on disk. */
  | { state: "missing"; shown: string };
