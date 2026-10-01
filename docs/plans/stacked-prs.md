# Stacked pull requests: one big issue, an ordered stack of small PRs

## Context

A run today works on one or more GitHub issues on exactly one branch, in one worktree, and opens exactly one pull request. `runs.branch_name` and `runs.base_branch` are single text columns (`packages/db/src/schema/runs.ts`), `createRun` in `packages/engine/src/runs.ts` names the branch `handoff/<slug>-<id8>` from the task and takes the base from `project.defaultBranch`, the PR node in `packages/engine/src/executors/github.ts` opens or reuses one PR with `base: run.baseBranch`, and the merge node queues that one PR in the project's merge queue (`packages/engine/src/merge-queue.ts`).

When an issue is big, one PR becomes big: slow CI, a review nobody wants to do, and a diff the Try it and code review pages cannot present in one sitting. The user asked whether handoff supports stacks: splitting a large issue into several PRs where each PR is based on the previous one's branch, reviewed in order and merged bottom up. It does not. This plan adds it.

The plan follows `docs/plan.md`: verified facts first, then the design, then PRs with their first failing tests at the seams named in `CLAUDE.md`. Code facts below were read from the worktree at commit `10b6991`.

## Goals

- A planner can propose that a task be delivered as an ordered stack of slices, each with its own steps, owned paths and acceptance criteria. A person approves or changes the split at plan review.
- One run codes the slices in order, each on its own branch stacked on the previous one, and opens one PR per slice with the previous slice's branch as base.
- Every existing node keeps working per slice: coder, tester, code review, Try it, demo, PR feedback loops.
- The merge node merges a stack bottom up at the run's turn in the merge queue, retargets the next PR, brings it up to date, waits for its CI and continues. Squash merges work.
- The dashboard shows the stack on the run page, in the Pull requests tab and in the merge queue, and lets a person merge the whole stack with one request.
- Failures (CI red on a higher slice, review feedback on a lower slice, conflicts with main, cancel, a person merging on GitHub by hand) leave the run in a state it can continue from or that a person can repair.

## Non-goals

- Splitting a diff that already exists. Slices are planned before coding, never carved out of a finished branch.
- Parallel coding of slices. A stack is coded in order; the CLI cap is one anyway (`HANDOFF_CAP_CLI=1`).
- Stacks that span several runs or several repositories.
- GitHub's native stacked pull requests as the primary mechanism (see "Decisions"). An optional follow-up can register a handoff stack with GitHub so its UI shows it.
- Rewriting history of a branch a person has already reviewed. Restacking merges, it does not rebase, except where a squash merge forces it (see "Git mechanics at merge time").
- Changing the merge queue's ordering rules. A stack is one queue entry.

## Verified facts

Checked on 2026-10-01 against the pages named. Re-check before coding against any of them.

GitHub pull request API

- `PATCH /repos/{owner}/{repo}/pulls/{pull_number}` accepts `base` ("The name of the branch you want your changes pulled into"). The docs add that the base may be updated "provided it is an existing branch within the same repository; you cannot point the base branch to a different repository." Source: https://docs.github.com/en/rest/pulls/pulls (read through Context7, library `/websites/github_en_rest`).
- `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge` takes `merge_method` (`merge`, `squash`, `rebase`), `sha` ("SHA that pull request head must match to allow merge"), `commit_title` and `commit_message`, and returns `sha`, `merged` and `message`. Same source.
- `GET /repos/{owner}/{repo}/pulls` filters by `state`, `head` (`user:ref-name`) and `base` (branch name). Same source.
- `DELETE /repos/{owner}/{repo}/git/refs/{ref}` deletes a reference; 204 on success, 409 conflict, 422 when the ref is the default branch. Source: https://docs.github.com/en/rest/git/refs (Context7).
- Repository settings `allow_merge_commit`, `allow_rebase_merge`, `allow_auto_merge`, `delete_branch_on_merge` and `allow_update_branch` exist on `PATCH /repos/{owner}/{repo}` and are returned by `GET /repos/{owner}/{repo}`. Source: https://docs.github.com/en/rest/repos/repos (Context7).
- A newer asynchronous merge endpoint, `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async` (API version `2026-03-10`), takes `merge_method`, `sha` and `merge_action` (`default`, `direct_merge`, `merge_queue`). Source: https://docs.github.com/en/rest/pulls/pulls and https://docs.github.com/en/pull-requests/reference/stacked-pull-requests-apis-and-webhooks.

GitHub behaviour around base branches

- When a merged pull request's head branch is deleted, GitHub retargets any open pull request that used that branch as its base to the merged PR's base branch. Sources: https://docs.github.com/en/pull-requests/how-tos/commit-changes/managing-branches-within-your-repository and the changelog entry of 2020-05-19, https://github.blog/changelog/2020-05-19-pull-request-retargeting/. Retargeting changes the base only; GitHub does not rebase or merge anything into the retargeted branch.
- Closing keywords such as `Closes #N` link and close an issue only when the pull request merges into the default branch. On a pull request whose base is another branch the keyword is ignored and no link is created. Source: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue.
- A squash merge of PR 1 (branch `s1` into `main`) writes one new commit with new SHAs. A branch `s2` created from `s1` still contains `s1`'s original commits. Retargeting PR 2 to `main` without touching `s2` makes PR 2's diff show `s1`'s changes again; a plain `git rebase main s2` replays `s1`'s commits and conflicts when patch-id matching fails. Source: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/about-pull-request-merges (squash section) plus the git rebase documentation for `--onto`. The two remedies are `git rebase --onto main <old-s1-head> s2` (needs the pre-merge tip of `s1`, which is also the `sha` passed to the merge endpoint) or `git merge main` into `s2`, where the three-way merge sees identical changes on both sides and resolves them.

GitHub native stacked pull requests

- Stacked pull requests are in public preview since 2026-07-30. Sources: https://github.blog/changelog/2026-07-30-stacked-pull-requests-are-now-in-public-preview/, https://docs.github.com/en/pull-requests/get-started/about-stacked-prs, https://docs.github.com/en/pull-requests/reference/stacked-pull-requests, https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-stacked-pull-requests.
- A stack is created with the `gh-stack` CLI extension (`gh extension install github/gh-stack`; commands `init`, `add`, `sync`, `push`, `submit`, `rebase`, `merge`; metadata under `.git/gh-stack`) or in the web UI. There is no REST or GraphQL endpoint that creates a stack. GraphQL exposes read-only `PullRequest.stack` and `stackEntry` (`PullRequestStack` with `baseRefName`, `entries`, `size`; entry position 1 is the bottom). Source: https://docs.github.com/en/pull-requests/reference/stacked-pull-requests-apis-and-webhooks.
- Merging the bottom PR of a native stack makes GitHub rebase and retarget the PRs above it. Only a contiguous group from the bottom can be merged, never a middle PR alone. Auto-merge is not supported for stacked PRs. Stacks are same-repository only. The feature is marked "subject to change". The `merge-async` endpoint, used on a stacked PR, includes all open PRs below it, and its responses carry a `stack` object (`base`, `size`, `position`, `id`, `number`). Sources: the reference and merging pages above.

Tools that implement stacks outside GitHub (read 2026-10-01)

- Graphite: `gt submit` opens one PR per branch with the parent branch as base, `gt restack` rebases children onto changed parents, and Graphite's merge flow rebases the branches above a merged PR onto trunk using temporary `graphite-base/*` branches. Source: https://graphite.dev/docs.
- ghstack: one PR per commit with synthetic `gh/<user>/<n>/base`, `/head` and `/orig` branches so each PR's diff is exactly one commit; landing goes through `ghstack land`, not GitHub's merge button. Source: https://github.com/ezyang/ghstack.
- spr (getcord/spr and ejoffe/spr): one commit per PR, rebase based; getcord/spr offers `base-branches`, `chain` and `github-stack` modes. Sources: https://github.com/getcord/spr and https://github.com/ejoffe/spr.
- git-town: `git town append` creates a child branch, `git town sync` merges the parent into the child by default (configurable `sync-feature-strategy`), `git town propose` targets the parent branch, `git town ship` ships only children of main, and deleting a shipped branch reparents its children. Source: https://www.git-town.com/.

Code facts (worktree at `10b6991`)

- `GitHubPort` (`packages/github/src/types.ts`) has `findPrByHead`, `createPr({head, base, title, body})`, `updatePr(number, {title, body})` (title and body only), `getPrSnapshot`, `mergePr(number, method?)`, `behindBy(base, head)`, `closeIssue`, `openBlockers`, `gitAuthEnv`. It has no way to change a PR's base, delete a branch or list PRs by base. `PrSnapshot` carries no base branch. `FakeGitHub` stores `pr.base` at creation and never reads or changes it; `mergePr` ignores the method.
- `syncWithBase` in the PR node fetches `origin/<base>`, checks `merge-base --is-ancestor`, merges with `git merge --no-edit -m "Merge <base> into this branch"` and reports `conflict` with the conflicting files after `git merge --abort`. It never rebases. The PR node pushes with `git push --force-with-lease -u origin HEAD:refs/heads/<branchName>`. Conflicts, CI failure and `changes_requested` all leave through the single `fix` port (`packages/core/src/graph/ports.ts`), because `compileGraph` builds a non-multi graphology `DirectedGraph`: one edge per ordered node pair.
- The PR body is the coder's `pr.body`, a Screenshots section, one `Closes #N` line per `state.issues`, then "Opened by handoff run". The engine does not trust the keyword: `closeLinkedIssues` in `github.ts` closes the run's issues itself after the merge, because a real run merged without GitHub closing its issue.
- The merge node joins the per-project queue (`joinQueue`, `queueTurn`, ordered by `runs.merge_queued_at`), yields `merge_queue` waits with key `mq:<projectId>`, and at its turn re-reads the snapshot: `merged` completes, `CONFLICTING` or `behindBy > 0` leaves through the `update` port back to the PR node while keeping the queue place, otherwise it merges with the node's `method` (`squash` default, `merge`, `rebase`), closes issues and wakes dependents (`deps:<projectId>`). Mode is `manual` (a person requests through `requestMerge` or `requestMergeAll`) or `auto`.
- Loop edges count attempts per edge key in `state.loops`; exhausted loops route to the graph's exhausted gate or fail the run. Joins use `edge_traversals`. Nothing resembling a sub-run or child run exists.
- `PlannerOutputSchema` (`packages/core/src/schema/outputs.ts`) is `{ status?, plan, steps: string[], ownedPaths: string[], acceptance?: string[], question? }`. The whole output lands in `state.plan`; `selectContext` (`packages/engine/src/context.ts`) gives the coder every step and uses `plan.ownedPaths` for `repoPaths` and the `diff_within_paths` constraint. Plan review is a `human_gate` in approval mode that renders the plan; the person can approve or request changes, not edit.
- `cancelRun` leaves the PR, the branch and the queue columns untouched. `repair` inserts a new attempt. `runAgain` creates a new run with a new branch.
- Dashboard: run page at `apps/web/src/app/projects/[projectId]/runs/[runId]/page.tsx` (`RunLive`), Pull requests tab with `PrList` and `MergeQueue` (`apps/web/src/components/pulls/`, row type `QueueRow { runId, task, prNumber, issues, queuedAt, requested, position, waiting, mode }`), server actions `requestMergeAction` and `requestMergeAllAction`. Tests exist as `merge-queue.test.tsx`, `pr-list.test.tsx`, `pull-filters.test.tsx`.
- Engine tests for the PR and merge nodes (`packages/engine/src/executors/github.integration.test.ts`, `merge-queue.integration.test.ts`) build a bare origin with `createOriginRepo`, run the scheduler with `drain`, inspect with `inspect`, and wake waits with `wakeByKey("gh:pr:42:<n>")` against `FakeGitHub`.
- Migrations live under `packages/db/drizzle/<timestamp>_<name>/migration.sql`, generated by `pnpm db:generate` (`drizzle-kit generate`, config `packages/db/drizzle.config.ts`). The latest is `20261001141412_permission_requests`.

## Unverified

- Whether GitHub's automatic retargeting on head branch deletion behaves the same for squash and rebase merges as for merge commits. The docs do not distinguish; the design never depends on it.
- Reports that deleting a merged PR's head branch through the API or `gh pr merge --delete-branch` closed the dependent PRs instead of retargeting them (cli/cli issue 14223 of 2026-08-21, community discussion 176698). Cause unknown. The design retargets through `PATCH base` before any branch deletion, so the report is a reason for the ordering, not a dependency.
- Whether a `Closes #N` keyword starts working after a PR is retargeted to the default branch. The engine closes issues itself regardless.
- Whether a rebase merge (`merge_method: rebase`) of a slice branch that contains merge commits from restacking succeeds on GitHub. Stacks default to squash and the plan refuses `rebase` with a stack until this is tested on a real repository.
- The exact `ref` form for the delete endpoint from Octokit (`heads/<branch>` without a leading `refs/`). PR 3's adapter test fixes it against a recorded response.
- Community reports (discussion 201439) of squash and commit verification problems when merging native GitHub stacks. Native stacks are an optional later PR anyway.
- The Mergify and Aviator stack documentation's claim that merge-based syncing keeps stacks conflict-free after squash merges. The design relies on the three-way merge argument stated under verified facts and on PR 6's integration test, not on those documents.

## Decisions

### 1. Who splits: the planner proposes, a person approves

Options considered:

- The planner proposes slices and the person approves the split at plan review. The planner already reads the issue and the repository, produces steps, owned paths and acceptance criteria, and plan review already exists as an approval gate. Slices are the same artefacts grouped and ordered. The person sees the split before any code exists and can send it back ("merge slices 2 and 3", "the migration must be its own slice").
- The person splits. Plan review has no editor today; building one that edits steps, paths and criteria per slice is a bigger UI than the feature itself, and the person would be doing the planner's job by hand.
- The coder splits after the fact. The diff already exists on one branch; cutting it into independently green slices means rewriting commits, re-running tests per cut and hoping the cuts are reviewable. Every stacking tool surveyed stacks before coding (one commit or branch per unit), none splits a finished branch.

Decision: the planner proposes slices only when the graph contains a `stack` node (so existing graphs never change behaviour), bounded by that node's `maxSlices`. The plan review page renders the slices, and the person answers approve, request changes, or "flatten" (run as one PR). The planner is told what makes a good slice: each slice leaves the app working and testable on its own, has its own acceptance criteria, and lower slices do not depend on higher ones.

### 2. Execution model: one run, one worktree, a `stack` node that advances a cursor

Options considered:

- One run that loops over slices, with one worktree and one branch per slice. Run state, events, repair, cancel, the merge queue and every dashboard page are keyed by run, and the worktree keeps every slice branch locally so restacking is a local git operation. The loop over slices rides on the existing loop-edge machinery, so it is bounded and visible in the graph.
- A parent run that spawns one child run per slice. Nothing in the engine creates runs from runs; a child would need its own worktree created from a sibling's branch, the merge queue would hold n entries that must merge in order, blockedBy gating would need run-level dependencies, and cancel and repair would need to cascade. The dashboard would show n runs for one issue.
- A `stack` node alone, as a sub-graph executor that runs coder, tester, review and PR for each slice internally. The engine has no sub-graphs; hiding the per-slice nodes inside one executor loses the per-node events, repair in place and the editable graph.

Decision: one run with a small `stack` node. The node is a `function` executor (no CLI) placed after the PR node. It keeps `state.stack.cursor`, creates the next slice's branch in the run worktree, restacks higher slices when a lower one changed, re-reads the stack's PRs for late review feedback, and leaves through one of two ports: `code` (back to the coder, with `state.stack.action` set to `next` or `fix`) or `done` (to the merge node). One port to the coder is forced by graphology's one edge per node pair, the same reason the PR node bundles CI failure, review feedback and conflicts into `fix`.

### 3. Git and GitHub mechanics: handoff's own chain, merge-based restack, retarget before delete

Options considered:

- GitHub native stacks through `gh-stack`. No API creates a stack, the CLI keeps its metadata in `.git/gh-stack` of the worktree, the feature is in public preview and "subject to change", auto-merge is unsupported, and `FakeGitHub` could not model it without reimplementing GitHub's rebase behaviour. It would also tie handoff to GitHub.com's current preview.
- handoff's own chain: branch per slice, `base` set per PR, retarget with `PATCH base` after each merge, bring the next branch up to date locally, push, wait for CI, merge. Every step is a documented REST call or a git command the engine already runs, and `FakeGitHub` can model all of it.

Decision: handoff's own chain now; an optional later PR registers the finished chain as a native stack for display, behind a project setting, once the preview stabilises. Restacking merges the lower branch into the higher one (consistent with `syncWithBase`, which never rebases, and with git-town's default); it never force-rewrites a branch a person has reviewed. At merge time the engine retargets the next PR to the run base through `PATCH base` before any branch deletion, then merges `origin/<base>` into the next slice (clean after a squash because both sides carry the same changes), pushes, and waits for CI on the retargeted PR before merging it.

### 4. The top PR closes the issue, through the engine

Only a PR merged into the default branch triggers closing keywords. The bottom PR is the only one based on `main` at creation, so a `Closes #N` there would close the issue when a third of the work merged. The top PR merges last. Every slice body says "Part of #N (slice k of n)" and links the other slices; the top PR additionally carries `Closes #N`, which GitHub may or may not honour after retargeting (unverified), and the engine's `closeLinkedIssues` runs once, after the top PR merges, exactly as today after the single PR.

### 5. One merge request merges the whole stack

The queue entry is the run. In manual mode the dashboard's row reads "Merge stack (3 PRs)" and one request merges all slices in order. Merging a prefix of a stack by hand is possible on GitHub but is not a dashboard action; the merge node tolerates it (see failure modes).

## Design

### Vocabulary

Added to `GLOSSARY.md` in PR 9:

- Stack: an ordered list of slices a run delivers as pull requests, each based on the previous slice's branch, merged bottom up.
- Slice: one unit of a stack with its own steps, owned paths, acceptance criteria, branch and pull request. Position 1 is the bottom.
- Restack: bringing a slice's branch up to date with the slice below it (or with the run base once the slice below merged) by merging that branch in, then pushing.
- Cursor: the slice a run is currently coding, fixing or merging (`state.stack.cursor`).

### Planner output and plan review

`PlannerOutputSchema` gains an optional `slices` array:

```
slices?: [{ title: string, steps: string[], ownedPaths: string[], acceptance?: string[] }]   // min 2, max stack.maxSlices
```

Refinements: `slices` is allowed only when the context packet says a stack node exists (`constraints.stack = { maxSlices }`); with slices present, the top-level `steps` and `ownedPaths` are the union in order (kept so existing readers of `state.plan` still work); slice `ownedPaths` may overlap between slices (a higher slice edits a file a lower one created), but every slice path must be inside the plan's `ownedPaths`.

The planner prompt (in `packages/engine/src/executors/cli-node.ts` or wherever the planner's system prompt lives; PR 7 locates it) gets a section used only when `constraints.stack` is set: propose slices only when the task has at least two independently testable parts; each slice must leave the app working; put schema and migration work in the lowest slice that needs it; name what a person can check per slice (the acceptance criteria that Try it and demo read); do not exceed `maxSlices`.

Plan review renders slices as numbered sections. Answers: approve (unchanged), request changes with a note (unchanged, the planner re-runs with the note), and a new "Flatten" option that approves the plan with `slices` removed. Flatten is a human answer, not a planner re-run, so it costs no CLI turn.

### Run state and the stack node

`RunStateSchema` gains:

```
stack?: {
  slices: [{ position: number, title: string, branch: string, base: string, steps: string[], ownedPaths: string[], acceptance?: string[],
             prNumber?: number, headSha?: string, coded: boolean, mergedSha?: string, folded?: boolean }],
  cursor: number,                // 1-based position the coder, PR node and merge node act on
  action: "next" | "fix" | "merge",
  fixReason?: { kind: "ci" | "review" | "conflict", files?: string[], from: number }
}
```

`state.stack` is written when the plan review gate passes with an approved plan that has `slices`: the gate's completion patch builds the slice list (branch names, bases, cursor 1, `action: "next"`) and writes the same rows to `run_slices`. The coder therefore sees the stack before the stack node ever runs. A graph without a plan review gate initialises it on the planner's completion instead. PR 4's first test pins this.

Stack node algorithm (one execution per visit, idempotent on re-claim):

1. Refresh: for every slice with a `prNumber`, `getPrSnapshot`. Record `headSha`. A snapshot with `changes_requested` or CI failure on a slice below the cursor sets `fixReason` and the cursor to that slice.
2. If `fixReason` is set: `git switch <slice.branch>`, leave through `code` with `action: "fix"`. The coder's packet carries the feedback exactly as the PR node's fix packet does today.
3. Else if a lower slice's `headSha` changed since the higher slices were last restacked (recorded per slice as `restackedFrom`): restack upward from that slice: for `i` from `changed + 1` to the top coded slice, `git switch s_i && git merge --no-edit -m "Restack onto <s_{i-1}>" <s_{i-1}>`; a conflict aborts the merge, sets `fixReason: { kind: "conflict", files, from: i }`, cursor `i`, and leaves through `code` with `action: "fix"`. Clean restacks push every touched branch with `--force-with-lease` (the lease is the recorded `headSha`, so a branch moved by a person on GitHub refuses the push and fails the execution with `error.code = "branch_moved"`, repairable).
4. Else if an uncoded slice remains: `git switch -c <next.branch> <top.branch>`, set cursor to it, `action: "next"`, leave through `code`.
5. Else: `action: "merge"`, leave through `done`.

Ports in `ports.ts`: `stack: [out("code", "code", { in: ["node.output.action", ["next", "fix"]] }), out("done", "done", { eq: ["node.output.action", "merge"] })]`. Compile rules in `compile.ts`: a `stack` node requires exactly one loop edge on `code` targeting a `coder` node with `maxAttempts` (the bound on slices plus fixes; the fixture uses `3 * maxSlices`), and `done` must reach a `merge` node. The stack node's config: `{ maxSlices: number (default 5, max 10) }`.

Loop counters: the `pr -> coder` fix edge and the `tester -> coder` edges count per edge today. With a stack, `applyLoopGuard` keys attempts as `<edgeKey>@<cursor>` when `state.stack` exists, so each slice has the same fix budget a single PR has today. The `stack -> coder` edge keeps the plain key, which is what bounds the stack as a whole.

### Coder, tester, code review, Try it and demo per slice

`selectContext` for a `coder` reads the cursor slice when `state.stack` exists: `constraints.ownedPaths` is the slice's paths (plus the lower slices' paths when `action` is `fix` on a lower slice, since a fix must not be forced to touch files the slice never owned), the task section names the slice ("Slice 2 of 3: <title>"), and the steps are the slice's steps. `diff_within_paths` compares against the slice's base branch (`git diff <base>...HEAD`), not against `origin/main`, so a higher slice is not blamed for a lower slice's files. PR 4 adds that `base` parameter to the check.

Tester, code review, Try it and demo already run against the worktree's current branch and read `state.plan.acceptance`. With a stack they read the cursor slice's `acceptance` (falling back to the plan's). No executor change beyond the selector that resolves "current acceptance criteria", which PR 4 centralises in `packages/engine/src/context.ts` as `currentSlice(state)`.

### PR node per slice

`prNodeExecutor` resolves `{ branch, base }` through `currentSlice(state)` when a stack exists, otherwise `{ run.branchName, run.baseBranch }` as today:

- Slice 1: branch `run.branchName`, base `run.baseBranch`. Unchanged, so a stack of one is a plain run.
- Slice k: branch `${run.branchName}-s${k}`, base `${run.branchName}-s${k-1}` (slice 1's branch has no suffix). Git refuses a branch named `a/b` next to `a`, which rules out `run.branchName/2`.
- `syncWithBase` syncs with the slice's base, not with `run.baseBranch`. Only slice 1 ever merges `main` directly; higher slices receive `main` through restacking, which keeps each PR's diff limited to its own slice.
- Push `--force-with-lease` of the slice branch only.
- `findPrByHead(slice.branch)` or `createPr({ head: slice.branch, base: slice.base, title, body })`. Title: `<task title> (k/n): <slice title>`. Body, built by `prText`:

```
Part of #N. Slice k of n in a stack opened by handoff run `<runId>`.

Stack (merge bottom up):
1. #<pr1> <title 1>   (merged | open | not yet opened)
2. #<pr2> <title 2>   <- this PR
3. (not yet opened) <title 3>

<coder pr.body>
<Screenshots section as today>

Closes #N            (top slice only)
Opened by handoff run `<runId>`.
```

  After every slice's PR exists or changes state, the PR node calls `updatePr` on every other open slice PR so the stack list stays current (`updatePr` already rewrites the body; the stack list is regenerated from state, the coder's text is kept from `state.stack.slices[i].prBody`).
- Wait keys are unchanged: `gh:pr:<repoId>:<n>` for the cursor slice. CI failure, `changes_requested` and sync conflicts leave through `fix` to the coder exactly as today, and the coder fixes the cursor slice.
- `runs.pr_number` is set to slice 1's PR when it opens (compatibility for lists that read it), and `run_slices.pr_number` holds every slice's PR.

### Git mechanics at merge time

The merge node declares `needsWorkdir: true` for stacked runs (today the PR node does, the merge node does not; PR 6's first test asserts the worktree still exists at merge time). At the run's queue turn, with `method` from node config (`squash` default; `rebase` fails the execution with `error.code = "stack_rebase_unsupported"` until verified):

For each slice `i` from the lowest unmerged position:

1. `getPrSnapshot(pr_i)`. If `merged`: record `mergedSha` (from the snapshot's merge commit when exposed, else leave null) and continue to `i + 1`. If `merged` and the snapshot's base is not `run.baseBranch` (a person merged it into the slice below on GitHub), mark the slice `folded` into slice `i - 1`, continue; slice `i - 1`'s PR now carries both and its CI reruns on its own.
2. If the slice's PR base is not `run.baseBranch` (true for every `i > 1` until retargeted): `updatePrBase(pr_i, run.baseBranch)`. Done before anything touches the lower branch, so GitHub's own retargeting (or the reported closing) on branch deletion never matters.
3. Bring the slice up to date: `git fetch origin <base>`, `git switch s_i`, `git merge --no-edit -m "Merge <base> into this branch" FETCH_HEAD`. After a squash of slice `i - 1`, `main` and `s_i` both carry slice `i - 1`'s changes relative to their merge base, so the three-way merge is clean; the only conflicts are real ones with commits that landed on `main` from elsewhere. A conflict leaves through the existing `update` port to the PR node with the cursor set to `i`, the PR node's `syncWithBase` reports the same conflict and routes `fix` to the coder, and the run keeps its queue place as it does today for a single PR.
4. Push `s_i` with `--force-with-lease`.
5. Wait for CI on `gh:pr:<repoId>:<pr_i>` (yield `github_pr` wait with the usual reconcile deadline; the run keeps its queue place). CI failure leaves through `update` (then `fix`), as in step 3.
6. `mergePr(pr_i, method, { sha: headSha })`, with `sha` so a branch moved under the engine refuses the merge. Record `mergedSha` and the pre-merge `headSha` (needed if a rebase-based restack is ever added).
7. Delete the merged branch `s_{i-1}`'s remote ref only when the repository has `delete_branch_on_merge` off and the project setting `deleteSliceBranches` is on (default on); slice branches are internal. When `delete_branch_on_merge` is on, GitHub deletes it itself and PR `i` is already retargeted by step 2.
8. After the top slice merges: `closeLinkedIssues`, `wakeDependents`, `leaveQueue`, complete with `{ merged: true, slices: n }`.

Each step records the slice's status in `run_slices` so a reclaimed execution resumes at the right slice without repeating a merge.

Why merge-based restack rather than `git rebase --onto`: reviewed branches keep their SHAs, review comments stay anchored, no force push surprises anyone, the conflict path is the one the PR node already has, and after a squash the three-way merge is clean. The cost is merge commits inside slice branches, which a squash merge hides. The pre-merge `headSha` is still recorded per slice so a later PR can offer rebase-based restacking for repositories that merge with merge commits and want linear history.

### Merge queue

A stacked run is one entry with `merge_queued_at` and `merge_requested_at` as today. `mergeQueue()` returns the extra fields `sliceCount` and `mergedCount` read from `run_slices`. `requestMerge(runId)` requests the whole stack. While the stack merges (steps 3 to 6 above repeat per slice), the run stays at position 1; a person sees "Merging 2 of 3" in the queue row. Nothing changes for single-PR runs.

### Dependencies

`blockedBy` gating is unchanged: it keys on the run's issues, and a stack has the same issues as a single PR. Dependents are woken once, after the top slice merges, because the issue closes then.

### Dashboard

- Run page: a "Stack" card between the steps and the graph when `run_slices` has rows. One row per slice: position, title, branch, PR link, status badge (planned, coding, open, checks, changes requested, approved, merging, merged, folded), the cursor marked. Clicking a slice opens its PR on GitHub; the review and Try it pages are per human gate and already show the current slice's diff because the worktree is on that branch.
- Plan review page: slices rendered as sections; "Flatten" button beside approve.
- Pull requests tab: `PrList` groups slice PRs under their run with "k of n" tags and shows them in stack order, bottom first. `MergeQueue` rows show "Merge stack (n PRs)" and the merge progress; `requestMergeAction` is unchanged in signature.
- Graph editor: the `stack` node appears in the palette with `maxSlices` in the inspector; `compileGraph` errors for a missing `code` loop edge or an unreachable merge node show inline like the existing compile errors. A new fixture `packages/core/src/fixtures/stacked.graph.json` holds start, planner, plan review gate, coder, tester, code review, pr, stack, merge, finish, with `pr -> coder` (fix), `stack -> coder` (code, loop), `merge -> pr` (update, loop).

### CLI

`handoff runs` shows `stack k/n` in the status column for stacked runs. `handoff run merge <runId>` (exists as the request path through the dashboard today; the CLI gets the same verb if it lacks one) requests the stack. No new commands otherwise.

### Failure modes

- CI fails on slice 2 after slice 1 merged: the merge node is waiting on slice 2's key, receives failure, leaves through `update` to the PR node with cursor 2; the PR node reads feedback and routes `fix` to the coder on `s2`; the coder fixes, tester and code review run on `s2`, the PR node pushes and waits for CI, the stack node finds nothing to code and leaves through `done`, the merge node resumes at slice 2 (slice 1 is recorded merged). The run never left the queue.
- Code review sends a slice back: if it is the cursor slice, the existing loops handle it. If it is a lower slice (review arrived while a higher slice was being coded), the stack node's refresh step sets the cursor to it with `fixReason.kind = "review"`, the coder fixes on that branch, and the next stack visit restacks every slice above it and pushes them; their CI reruns.
- Conflicts with main mid-stack: only slice 1 syncs with `main` directly (through the PR node), and a conflict there routes `fix` as today. After the fix, the stack node restacks upward; a conflict during restack sets `fixReason.kind = "conflict"` with the files for that slice. At merge time, conflicts surface in step 3 and route through `update`.
- Cancelling a run mid-stack: as today, `cancelRun` aborts executions and leaves PRs, branches and queue columns alone; merged slices stay merged (they were reviewed and green). The run page shows the stack with its final statuses. Reopening the work is `runAgain`, which starts a new run and a new stack; open PRs of the cancelled run are the person's to close. An optional `--close-prs` flag is listed under open questions.
- A person merges out of order on GitHub: merging PR 2 into `s1` (its base) folds slice 2 into slice 1; the merge node's refresh marks it `folded` and slice 1's PR carries both. Merging PR 1 by hand is the correct order and the merge node simply finds it merged. Merging PR 2 into `main` by hand after retargeting it is also just "merged". A person who closes a slice PR without merging makes the merge node fail with `error.code = "slice_pr_closed"` and the slice number; repair re-creates the PR from the branch.
- A worker crash mid-merge: every step writes `run_slices.status` first, so the reclaimed execution re-reads snapshots and resumes; `mergePr` with `sha` and `findPrByHead` make steps 2, 4 and 6 idempotent.
- Loop exhaustion: the `stack -> coder` edge's `maxAttempts` routes to the exhausted gate like any loop; the gate's context names the slice.

## Data model

New table `run_slices` (`packages/db/src/schema/run-slices.ts`, migration `pnpm db:generate` as `<timestamp>_run_slices`):

| column | type |
|---|---|
| id | uuid pk |
| run_id | uuid fk runs, not null |
| position | integer not null |
| title | text not null |
| branch_name | text not null |
| base_branch | text not null |
| pr_number | integer null |
| head_sha | text null |
| merged_sha | text null |
| status | `slice_status` enum: planned, coding, open, changes_requested, approved, merging, merged, folded, abandoned |
| created_at, updated_at | timestamptz |

Unique `(run_id, position)`; index `(run_id)`; index `(pr_number)` for the Pull requests tab. The engine writes it from the stack node, the PR node and the merge node through `packages/db/src/ops/slices.ts` (`replaceSlices`, `setSlicePr`, `setSliceStatus`). Run state stays the source of truth for routing and context; the table is for the dashboard and for resumable merging. No change to `runs` beyond continuing to set `pr_number` to slice 1's PR. No secrets are involved.

An ADR, `docs/adr/0006-stacked-prs-as-a-branch-chain.md`, records decision 3 (own chain, merge-based restack, retarget before delete, native stacks deferred).

## Delivery

Each PR is one branch and one GitHub issue, worked test first. Test names use the glossary.

1. Core: stack vocabulary in schemas and catalog. First tests: `packages/core/src/schema/outputs.test.ts` "PlannerOutputSchema accepts at most maxSlices slices and rejects a slice path outside the plan's owned paths"; `run-state.test.ts` "RunStateSchema round-trips a stack with a cursor"; `graph/catalog.test.ts` "the catalog has a stack node of executor kind function with ports code and done"; `graph/compile.test.ts` "compileGraph rejects a stack node without a loop edge on its code port", "compileGraph rejects a stack node whose done port does not reach a merge node", "compileGraph accepts the stacked fixture"; `graph/routing.test.ts` "nextEdges leaves a stack node through code for next and fix and through done for merge"; `graph/react-flow.test.ts` "fromReactFlow(toReactFlow(g)) round-trips the stacked fixture".
2. Database: `run_slices`. First tests: `packages/db/src/migrate.integration.test.ts` (existing idempotency test covers the new migration); `packages/db/src/ops/slices.integration.test.ts` "replaceSlices stores slices in position order and is idempotent", "setSliceStatus moves one slice without touching the others".
3. GitHub adapter: `updatePrBase(repo, number, base)`, `deleteBranch(repo, branch)`, `listPrsByBase(repo, base)`, `PrSnapshot.baseRefName` and `PrSnapshot.mergeCommitSha`, `mergePr` with `sha`. First tests in `packages/github/src/octokit-client.test.ts` (recorded responses, same style as "closeIssue comments on the issue and closes it as completed"): "updatePrBase patches the base branch", "deleteBranch deletes heads/<branch> and treats 422 on a missing ref as already deleted", "listPrsByBase lists open pull requests on a base", "mergePr passes the expected head sha". `FakeGitHub`: "FakeGitHub refuses to delete a branch that is the base of an open pull request" (so engine tests prove the retarget-before-delete order), "FakeGitHub records base changes", "FakeGitHub mergePr fails when sha does not match the head". `packages/github/src/queries/pull-request.graphql` gains `baseRefName` and `mergeCommit { oid }`, followed by `pnpm --filter @handoff/github codegen`.
4. Engine: stack initialisation, the stack node, per-slice context and checks. First tests: `packages/engine/src/executors/stack.integration.test.ts` "approving a plan with slices writes a stack with slice 1 as cursor into run state and run_slices", "stack node creates the next slice branch from the top slice and leaves through code with action next", "stack node leaves through done when every slice is coded", "stack node restacks higher slices after a lower slice changed and pushes them", "stack node routes a restack conflict to the coder with the conflicting files", "stack node sets the cursor to a lower slice whose pull request got changes requested"; `context.integration.test.ts` "coder context for slice 2 names the slice and limits owned paths to it"; `contract/validate.test.ts` "diff_within_paths compares against the slice base, not the run base"; `routing/loop-guard.test.ts` "loop attempts on a fix edge are counted per slice when a stack exists".
5. Engine: PR node per slice. First tests in `github.integration.test.ts`: "PR node opens slice 2 on the slice 1 branch as base", "PR node syncs slice 2 with slice 1, not with main", "PR body names the slice position, lists the stack and closes the issue only on the top slice", "PR node refreshes the stack list in every open slice body", "PR node sets runs.pr_number to the bottom slice's pull request".
6. Engine: merge node merges a stack. First tests in `merge-queue.integration.test.ts`: "a stacked run joins the queue as one entry with its slice count", "merge node still has the run worktree at its turn", "merge node retargets slice 2 to main before deleting the slice 1 branch", "merge node merges main into slice 2 after a squash of slice 1 without conflict and waits for its checks", "merge node merges slices bottom up and closes the issue after the top slice", "merge node resumes at slice 2 after CI failed there and the coder fixed it", "merge node marks a slice merged by hand into the slice below as folded", "merge node fails with stack_rebase_unsupported when method is rebase", "a reclaimed merge execution does not merge a slice twice".
7. Planner prompt and plan review: slices in the prompt and on the page. First tests: `plan-review.integration.test.ts` "plan review with slices offers flatten and flatten approves the plan without slices", "a planner run without a stack node in the graph rejects slices in its output"; `apps/web/src/components/review/plan-review.test.tsx` (or the existing plan review component test) "plan review renders slices as numbered sections".
8. Dashboard: run page stack card, Pull requests tab grouping, merge queue stack row. First tests: `apps/web/src/components/runs/stack-card.test.tsx` "stack card lists slices in order and marks the cursor"; `pr-list.test.tsx` "pull request list groups slice pull requests under their run bottom first with k of n tags"; `merge-queue.test.tsx` "a stacked entry shows merge stack with its slice count and merge progress"; graph editor test "the palette offers a stack node whose inspector edits maxSlices". Run `pnpm doctor:react` after.
9. CLI, glossary, ADR: `handoff runs` status column, `GLOSSARY.md` terms, ADR 0006, `docs/plan.md` cross-reference. First test: `apps/worker/src/cli.test.ts` "handoff runs prints stack k/n for a stacked run".
10. Optional, after the above shipped and ran on a real repository: register the chain as a GitHub native stack for display (`gh-stack` in the worktree behind a project setting), marked experimental in the dashboard. No first test until the preview API is re-verified.

## Risks

| Risk | Mitigation |
|---|---|
| GitHub closes dependent PRs when a base branch is deleted through the API (unverified reports) | Retarget through `PATCH base` before any deletion; `FakeGitHub` refuses deleting a branch that is still a base, so the order is tested. Branch deletion is optional and off when `delete_branch_on_merge` is on. |
| Merge-based restack leaves merge commits that a `rebase` merge method cannot land | Squash is the default; `rebase` with a stack fails early with a clear code until tested on a real repository. |
| A person edits a slice branch on GitHub while the engine restacks | Every push is `--force-with-lease` against the recorded `headSha`; a refused push fails the execution with `branch_moved`, which is repairable after a person looks. |
| Late review feedback on a lower slice invalidates work on higher slices | The stack node restacks upward after every lower fix and CI reruns on every touched PR; review comments stay anchored because branches are merged into, never rewritten. |
| Loop budgets exhaust faster with several slices | Fix-edge attempts are counted per slice; the `stack -> coder` edge bounds the whole stack and routes to the exhausted gate. |
| The planner produces slices that are not independently green | The plan review shows acceptance criteria per slice, and "flatten" is one click. The tester runs per slice, so a broken slice fails before its PR opens. |
| `runs.pr_number` readers assume one PR per run | Set to slice 1's PR; `PrList` and `MergeQueue` read `run_slices` when rows exist (PR 8), and the agent MCP tools in `apps/web/src/server/agent-mcp.ts` get the slice list in `get_run`. |
| GitHub's native stack preview changes | Not depended on; PR 10 is optional and last. |

## Open questions

1. Should a merge request merge the whole stack, or should the dashboard also offer "merge up to slice k"? Recommended: whole stack in v1; the merge node already tolerates a person merging a prefix on GitHub.
2. Should the PR node wait for approval of slice k before the coder starts slice k+1 (`requireApproval` per slice), or open all slices and let reviews arrive in any order? Recommended: do not block; the stack node's refresh and restack handle late feedback, and reviews can run in parallel with coding.
3. Should `cancelRun` close the stack's open PRs? Recommended: no, as today for a single PR; add `handoff run cancel --close-prs` later if cancelled stacks accumulate.
4. Should slice branches be deleted after each merge when the repository does not auto-delete? Recommended: yes (project setting `deleteSliceBranches`, default on), always after the retarget.
5. Should the planner propose slices by default whenever the graph has a stack node, or only when the issue carries a label such as `stack`? Recommended: by default, with the planner told to prefer one slice unless the task has at least two independently testable parts; the person can flatten at plan review.

## Verification

Tests and checks, as in `docs/plan.md`:

```bash
pnpm db:up
pnpm test
pnpm typecheck && pnpm lint
pnpm doctor:react
```

End-to-end on the user's todoOverKill project, run from a separate worktree so `tsx watch` does not restart the worker under a live run:

1. Import `packages/core/src/fixtures/stacked.graph.json` into the todoOverKill project (`pnpm handoff graph import --project todooverkill --name stacked packages/core/src/fixtures/stacked.graph.json`) and set `maxSlices` to 3 in the editor.
2. Pick or write a deliberately big issue in todoOverKill: a feature that needs a schema change, a server endpoint and a UI change (for example a tags feature: tag table and migration, tag API, tag picker in the UI). Confirm the planner proposes three slices in that order and that plan review shows acceptance criteria per slice.
3. Approve. Expect on the run page: slice 1 coded, tested, reviewed, PR `(1/3)` opened on `main`; stack node creates `-s2` from slice 1's branch; PR `(2/3)` opened with base `<run branch>`; PR `(3/3)` with base `<run branch>-s2`. On GitHub each body lists the stack and only `(3/3)` says `Closes #N`.
4. While slice 3 is being coded, request changes on PR 1 from GitHub. Expect the stack node to move the cursor to slice 1, the coder to fix it, and the next stack visit to restack and push `-s2` and `-s3`.
5. In the Pull requests tab, click "Merge stack (3 PRs)". Expect: PR 1 squash merged; PR 2 retargeted to `main` on GitHub before the slice 1 branch disappears; `main` merged into `-s2`; CI reruns and PR 2's diff shows only slice 2's changes; PR 2 merged; the same for PR 3; the issue closed with the engine's comment; `git -C .handoff/repos/<owner>/todooverkill worktree list` clean after the run; slice branches deleted on GitHub.
6. Repeat step 5 on a second issue but merge PR 1 by hand on GitHub before clicking merge. Expect the merge node to find it merged and continue at slice 2.
7. Cancel a third stacked run after PR 2 opened. Expect both PRs still open on GitHub, the run page showing the stack with slice 3 planned, and no leftover worktree.
