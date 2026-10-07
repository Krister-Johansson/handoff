# Review threads: answer every review comment, then resolve it after the next review

## Context

Krister handles every review comment on a pull request, from CodeRabbit or a person, by one rule:

1. Validate the comment like a test: check its claim by running the command it names, reading the code it points at, or writing a failing test when it is about code.
2. If it holds, fix it on the PR branch and push.
3. Reply on the thread: whether it was valid, the evidence, and the fixing commit, or why nothing changed.
4. Wait for the reviewer's next review after the push, and resolve the thread only if that review does not raise the point again. Never resolve right after pushing.

handoff does steps 1 and 2 today, partly, and never does 3 or 4. On `northMES/northmes` the `main` ruleset requires resolved conversations, so an unanswered thread blocks the merge. Run `33311b09` (graph `northmes-guided`, PR northMES/northmes#192) shows the cost. The PR step sent CodeRabbit's thread to the coder, the coder correctly changed nothing, and the run went round the loop (pr, coder, tester, code-review, code-gate, demo, pr) without anyone replying. A person replied with the evidence and resolved the thread by hand before the merge went on.

A second pull request, northMES/northmes#208, shows findings that never become review threads. CodeRabbit's summary comment carried a walkthrough note and a failed pre-merge check (the title check, in warning mode). handoff reads neither.

This plan makes the PR node run Krister's rule for every review comment it sends back, including the notes and checks in CodeRabbit's summary comment. It follows `docs/plan.md` and `docs/plans/run-feedback.md`: verified facts first, then decisions, design, and PRs with their first failing tests at the seams named in `CLAUDE.md`.

## Goals

- Every review comment the PR node sends to the coder gets a verdict from the coder (fixed, declined or unclear) with evidence, checked by the contract.
- handoff, not the agent, posts the answer on GitHub: a reply in the thread, or one PR comment for findings that have no thread.
- A round where the coder only declines or asks goes straight back to the PR node. It does not run the tester, code review, gates or demo again, and it does not send the same comment round the loop again.
- The PR node resolves a thread only after the reviewer's next review leaves the point alone, and never right after a push.
- A reviewer who disagrees again, or who never reviews again, brings in a person with both sides of the argument.
- CodeRabbit's summary comment for the newest commit is read: walkthrough notes and failed or warning pre-merge checks become findings like any other.
- The run page, the inbox and MCP show each comment, its verdict, the evidence, the fixing commit and where it stands.

## Non-goals

- Replying to or resolving threads the run did not send to the coder, such as threads on a pull request handoff did not open.
- A review bot other than CodeRabbit for the summary comment. The parser is CodeRabbit's; the item model takes another bot's parser later.
- CodeRabbit Autopilot (autofix, `fix_ci`, `resolve_merge_conflict`). It stays off; see Decision 11.
- Changing how the merge node waits on unresolved threads (PR #650). It stays the backstop for threads handoff does not manage.
- Re-approval at human gates after a fix. A round with a fix takes the normal path, and the gates behave as they do today (`approval.held` when only main changed).

## Verified facts

Code facts are from `main` at `f927122`, read on 2026-10-05. GitHub facts are from northMES/northmes#192 and #208, read through the API on the same day.

### The PR node and external review

- `prNodeExecutor` (`packages/engine/src/executors/github.ts:203-341`) pushes on its first execution of a round (`pushing = !ctx.execution.wakeReason`), reads a PR snapshot, and waits while checks are pending, an approval is missing, or a listed reviewer has not reviewed the head commit.
- `externalReview` (`packages/engine/src/executors/external-review.ts:55-73`) collects, as findings, unresolved inline threads whose first comment is not handoff's (id `thread:<first comment databaseId>`) and review summaries on the head commit that are not approvals (id `review:<id>`). It skips ids in `state.prHandledReviews`. It does not read issue comments, so CodeRabbit's summary comment is never a finding.
- With `sendReviewComments` on, the findings go to the coder through the `fix` port as `changes_requested` feedback, and their ids are appended to `prHandledReviews` (`github.ts:330-338`). Each finding is sent once. Nothing is posted back on GitHub, and nothing resolves a thread.
- `reviewRequest` posts `@<reviewer> review` once per head SHA, with the marker `<!-- handoff:review-request <sha> -->` (`external-review.ts:21-30`, `github.ts:186-196`).
- Comments handoff writes carry `HANDOFF_COMMENT_PREFIX` (`<!-- handoff:`), and `toFeedback` leaves them out of feedback (`packages/github/src/feedback.ts:5, 36`). `externalReview` only checks a thread's first comment for the prefix.
- The merge node waits while GitHub reports `BLOCKED` and threads are unresolved, emits `merge.threads_unresolved` with each thread, and notifies once (`github.ts:502-523`). The run page shows them in `ReviewThreadsCard` (`apps/web/src/components/runs/review-threads-card.tsx`), and `get_run` reports `waiting_on: review_threads` (`apps/web/src/server/step-states.ts`).
- The webhook route wakes the PR's key on `pull_request_review`, `pull_request_review_comment`, `pull_request_review_thread` and `issue_comment` (`packages/github/src/webhook-events.ts:9-37`).

### GitHub adapter

- The snapshot query reads `reviewThreads(first: 100)` with `isResolved` and the first comment only (`databaseId`, author login, body, path, line, url). It reads no thread id, no `isOutdated`, no later comments and no author type (`packages/github/src/queries/pull-request.graphql:59-75`). Issue comments are `comments(last: 50)` with author, body and url, and no id or edit time (`:76-84`).
- `unresolvedReviewThreads` has its own query with `isOutdated`, path and line, still without the thread id (`queries/pull-request-threads.graphql`).
- `GitHubPort` (`packages/github/src/types.ts:125-185`) has no method to reply to a thread or resolve one. It has `upsertPrComment` (marker based) and `listIssueComments`, which pages an issue's comments through REST and works for pull requests.
- `FakeGitHub` builds threads without ids and resolves them only all at once (`resolveThreads`, `packages/github/src/testing/fake-github.ts:343-345`).
- `docs/plan.md:276` lists the GitHub App's permissions: contents and pull requests read and write, checks, actions and metadata read.

### The GitHub API

From the GraphQL reference, through Context7:

- `PullRequestReviewThread` has `id`, `isResolved`, `isOutdated`, `path`, `line`, `originalLine`, `resolvedBy`, `viewerCanReply`, `viewerCanResolve`, `viewerCanUnresolve` and `comments`.
- `addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId, body })` returns the new `comment`.
- `resolveReviewThread(input: { threadId })` returns the `thread`. Its input also has `resolutionReason`, for Copilot review threads only.

### The coder and its feedback

- `CoderOutputSchema` (`packages/core/src/schema/outputs.ts:44-59`) has `status`, `summary`, `question`, `filesChanged`, `commitSha`, `extraPaths` and `pr`. It has no per-comment verdict.
- The coder's packet lists review comments under "Previous attempt", "Review comments" as `path:line - author: body` (`packages/core/src/context/render.ts:374-392`), from `feedbackFrom` (`packages/engine/src/context.ts:24-67`). Comments carry no id the coder could answer by.
- The coder prompt says to address every point under Previous attempt (`packages/engine/src/executors/cli-node.ts:100-103`). Nothing asks it to check a claim before acting on it.
- The compiled graph is a graphology `DirectedGraph` (`packages/core/src/graph/compile.ts:179`), so one edge per ordered pair of nodes. The PR node's `fix` port is a feedback port with a loop limit of 3 by default (`packages/core/src/graph/ports.ts:35-45`, `compile.ts:104-123`).
- An executor's `waiting` outcome carries no state patch (`packages/engine/src/types.ts:67`). Only a completed step writes run state.
- The paths question is a question the engine creates on a waiting execution, with options and a `reason` in its context, outside any human gate node (`packages/engine/src/scheduler/complete.ts:387-430`).
- `approval.held` lets code review and approval gates pass without work when the run's own change is unchanged since their approval (`packages/engine/src/approvals.ts`).

### Run 33311b09 (northMES/northmes#192)

From `get_run` and `get_run_events`, and the PR's threads through GraphQL.

- CodeRabbit (author type `Bot`, login `coderabbitai`) submitted a `CHANGES_REQUESTED` review on `3467df9` at 16:17:17 with one thread on `vitest.config.ts`.
- `pr` attempt 1 sent the work back at 16:17:28. `coder` attempt 2 ran 54 seconds and passed with no new commit. `tester` attempt 2 ran, `code-review` and `code-gate` attempt 2 passed through `approval.held`, `demo` was skipped, and the PR node's join was reached at 16:18:23.
- Krister replied in the thread at 16:26:48 with the evidence (ADR 0041). CodeRabbit submitted an `APPROVED` review on the same commit at 16:26:56, eight seconds later. Krister resolved the thread.
- `pr` attempt 2 was claimed at 16:27:33 and passed at 16:27:38. `merge` waited from 16:27:38 and merged at 17:01:34.

### northMES/northmes#208

From the issue comments and GraphQL.

- CodeRabbit keeps one summary issue comment per pull request and edits it in place (created 17:59:45, updated 18:12:37). It starts with `<!-- This is an auto-generated comment: summarize by coderabbit.ai -->`.
- The comment marks its sections with HTML comments: `<!-- walkthrough_start -->` and `_end`, `<!-- final_review_risk_start -->` and `_end`, `<!-- pre_merge_checks_walkthrough_start -->` and `_end`, `<!-- autopilot:start -->` and `:end`.
- The commit the summary covers is in `<!-- final_review_risk_coverage:{"sourceCommitId":"<sha>","coveredCommitId":"<sha>","kind":"reviewed"} -->`, and again in `<!-- change_assessment_commit:"<sha>" -->`.
- While CodeRabbit works on a newer commit, the comment holds a block between `<!-- This is an auto-generated comment: review in progress by coderabbit.ai -->` and its end marker, which names the commit range it is reviewing.
- The walkthrough note is the prose after the coverage marker in the final review risk section.
- Pre-merge checks are a table under "Failed checks (n warning)" with the columns Check name, Status, Explanation and Resolution. The table cells are cut short with an ellipsis; the full text is in a `<details>` block named "Full details: <check name>" with **Explanation** and **Resolution** paragraphs. Passed checks are in a separate table.
- `@coderabbitai review` on a commit CodeRabbit has already reviewed gets a reply that it already reviewed the last commit and does nothing. The reply starts with `<!-- This is an auto-generated reply by CodeRabbit -->`.
- CodeRabbit resolved its own thread on #208 after the fix in `94c0c6c` (`resolvedBy: coderabbitai[bot]`, `isOutdated: true`). Krister answered both summary findings in one PR comment by hand.

## Unverified

Each item names where it is checked before the PR that depends on it.

- Whether `resolveReviewThread` works with the credential handoff runs with: the GitHub App (pull requests write), or a personal token of the pull request's author. The design reads `viewerCanResolve` and `viewerCanReply` on every thread and never assumes; PR 1 checks both on a scratch pull request.
- Whether CodeRabbit answers a reply in its thread without a mention every time. One sample (#192) says it reviews again within seconds. PR 6 records the reviewer's response time per item, so the default wait can be tuned.
- Whether CodeRabbit updates `final_review_risk_coverage` on every incremental review, and whether it re-runs pre-merge checks when only the title changes. PR 2 checks on a scratch pull request; Decision 7 does not depend on either.
- Whether a bot's `CHANGES_REQUESTED` review sets the pull request's `reviewDecision`. Decision 5 handles both cases.
- Why `pr` attempt 2 in run `33311b09` was claimed nine minutes after its join was reached. Not relied on; the return in Decision 4 does not go through the join.

## Decisions

### 1. Review items, kept in a table

Every finding an external reviewer leaves on the run's pull request is a review item: an inline thread, a review summary that is not an approval, a note in CodeRabbit's summary comment, or a failed or warning pre-merge check. Each gets a handle that is stable for the run, `R1`, `R2` and so on, which the coder answers by and the dashboard shows.

Items live in a new table, `review_items`, one row per item per run. Run state was the other option. It is rejected for three reasons. The PR node posts replies and resolves threads while it waits, and a waiting outcome writes no run state. The run page, `get_run` and the inbox read items without parsing run state. The rows hold the idempotency record (which reply was posted for which head commit), which must survive a restarted worker, a reclaimed lease and a repair.

Run state keeps what agents read: the PR node's output carries the items it sends, with their handles, and the coder's answers come back in its output.

An item moves through these states:

- `open`: found, and waiting for the coder's answer.
- `answered`: the coder answered, and handoff has not posted the answer yet (the round is still in the tester or the gates).
- `awaiting_review`: the answer is on GitHub, and handoff waits for the reviewer's next review.
- `resolved`: handoff resolved the thread, the reviewer or a person did, or the next summary no longer lists the finding. `resolved_by` says which.
- `disputed`: the reviewer raised the point again after the coder declined it twice, or never reviewed again. A person decides.
- `reraised`: the reviewer opened a new thread on the same lines; the item follows the new one.
- `left`: a person took it over. handoff does not touch it again.
- `gone`: the thread or the finding no longer exists on GitHub.

### 2. The coder validates each item like a test and answers it

The coder's packet gets a section "Review comments to answer" in place of the plain list, with each item's handle, kind, reviewer, file and line, link, and the whole conversation for an item that came back with a reply. The coder prompt adds the rule:

> Treat each review comment like a test. Check its claim before you act: run the command it names, read the code it points at, or, when it is about the code's behaviour, write a failing test that shows it. If the claim holds, fix it, commit, and give the commit. If it does not hold, change nothing for it and give the evidence: the command and its output, the file and lines, or the test that passes. If you cannot tell, say what is unclear. Answer every listed comment in `answers`. Do not reply on GitHub; handoff posts your answers.

`CoderOutputSchema` gains `answers`:

```ts
answers?: {
  id: string;                 // "R3"
  verdict: "fixed" | "declined" | "unclear" | "duplicate" | "settled";
  evidence: string;           // what was checked and what it showed
  commit?: string;            // with fixed: the commit that fixes it
  of?: string;                // with duplicate: the item it repeats, such as "R2"
}[]
```

`duplicate` is for a summary note that repeats an inline thread, as on #208; the answer points at the other item. `settled` is only for an item that came back with the reviewer's reply, when that reply accepts the earlier answer. The task's own plan is unaffected; a fix still has to stay within the owned paths.

The engine adds a deterministic check, `review_items_answered`, to a coder attempt that a PR node sent items to. It is implicit, so existing graphs need no contract change, and it fails the attempt, which retries with the failed check in its packet, when:

- an item sent has no answer, or has two;
- an answer names an item that was not sent;
- `fixed` has no commit, or the commit is not on the branch, or it was already on the branch when the round started. A summary note or pre-merge check may be `fixed` without a commit when its evidence says what changed, such as the pull request's title; handoff then answers "Valid. Fixed." (approved with step 8);
- `declined`, `unclear` or `duplicate` has empty evidence, or `duplicate` names an unknown item;
- `settled` answers an item that came back without a reviewer reply.

An attempt sent back by the tester or a gate in the same round needs no answers. Its answers, when it gives some, replace the earlier ones for those items. The coder executor writes the answers into run state (`reviewAnswers`, keyed by handle), and the PR node, the only writer of `review_items`, records them when it runs next.

The handle is short on purpose. The GraphQL thread id (`PRRT_kwDO...`) was the other option; a model copies a short handle more reliably, and the contract catches a typo either way.

### 3. handoff posts the answers

The PR node posts answers in its pushing execution, after the push, so a fixing commit is on GitHub and its link works. The agent never posts: the coder has no GitHub credential, and one writer keeps the format and the idempotency in one place.

An item with a thread gets a reply in that thread with `addPullRequestReviewThreadReply`:

```text
Valid. Fixed in 94c0c6c.

`gh issue edit --help` on gh 2.101.0 lists --attach, so the sentence was wrong. The step now states the commit-first requirement.

<sub>Answered by handoff run `33311b09`. handoff resolves this thread after the reviewer's next review, unless that review raises it again.</sub>
<!-- handoff:item-reply R3 94c0c6c8a1... -->
```

The first line is one of "Valid. Fixed in <commit link>.", "Not changed." (the evidence says whether the comment is wrong or out of scope), "Unclear:" followed by the question, or "Same point as <link to the other item>.". The evidence follows as the coder wrote it, cut at 4,000 characters.

Items without a thread (review summaries, summary notes, pre-merge checks) are answered together in one new PR comment per round, one paragraph per item with the same first lines, ending with `<!-- handoff:item-answers <round> <head sha> -->`. A new comment per round, not an edit of the last one, so the reviewer sees an answer to its newest findings.

Both markers start with `HANDOFF_COMMENT_PREFIX`. `externalReview` learns to skip every comment with the prefix, not only a thread's first, so an answer never comes back as feedback.

Posting is idempotent per item and head commit. Before it posts, the PR node looks for its marker among the thread's latest comments, or among the PR's comments for a round answer, and records the found comment instead of posting again. A worker that dies between posting and recording posts nothing twice.

`settled` posts no reply; the PR node resolves the thread at once, since the reviewer has already answered.

### 4. An answer-only round goes straight back to the PR node

A round where every answer is `declined`, `unclear`, `duplicate` or `settled`, the branch head is the commit the PR node sent, and the worktree is clean, is answer-only. The coder executor sets `answerOnly: true` on its output, which the agent cannot set, the way the demo sets `skipped`.

When a coder attempt that a PR node's `fix` edge triggered passes with `answerOnly`, the engine creates the PR node's next execution directly and takes none of the coder's outgoing edges. The event `edge.returned` says "answered review comments only; back to pr". The `fix` edge's loop counter was counted once when the work went to the coder, and the return adds nothing to it.

The tester, code review, gates and demo do not run, because nothing they check changed: the head is the commit they passed. A round with a fix takes the normal path, since new code needs its tests and its review. A mixed round takes the normal path, and the PR node posts every answer when the round reaches it.

The other option was a new coder port, `answered`, wired to the PR node. It fails on two points. A graph that already has a coder to PR edge (the `linear` template) cannot have a second one, since the compiled graph allows one edge per pair. And `done` and `answered` would both match an answer-only output unless `done`'s condition depended on whether an `answered` edge exists, which no other port does. The return works in every graph without a migration. A PR node can turn it off with `reviewThreads.returnOnAnswerOnly: false`.

A declined comment goes to the coder once, to be validated. After the answer is posted it does not go again unless the reviewer replies.

### 5. The PR node waits for the reviewer's next review, then resolves

After it posts answers, the PR node waits while any item is `awaiting_review`, on the PR's webhook key with a deadline, and its step reports `waiting_on: re_review`. On each wake it checks every such item:

1. The thread is resolved on GitHub: `resolved`, with `resolved_by` from `resolvedBy` (CodeRabbit resolves its own threads after a fix, as on #208).
2. The thread no longer exists: `gone`.
3. Someone other than handoff commented in the thread after the answer. A comment by the reviewer sends the item back to the coder in the next round, as `open` with the conversation (Decision 6). A comment by anyone else, such as a person replying by hand, makes it `left`.
4. The reviewer submitted a review after the answer was posted, on the answer's head commit or a later one, and that review opened no thread on the same file within three lines of the item's line or original line. The PR node resolves the thread with `resolveReviewThread`: `resolved`, by handoff. On #192 this is CodeRabbit's `APPROVED` review eight seconds after the reply.
5. That review opened a thread on the same lines: the old item is `reraised` and points at the new one, which enters as a new item. The old thread is resolved when the new item is resolved.

An answer posted after a push never resolves on that push alone. The review in check 4 must be submitted after the answer, so a thread is never resolved in the same execution that pushed. An outdated thread is shown as outdated and counts for nothing on its own: GitHub marks a thread outdated when its lines change, which says nothing about whether the reviewer agrees.

Items without a thread have nothing to resolve. A review summary item is done when the reviewer's next review on a later commit does not repeat it. Summary notes and pre-merge checks are Decision 7.

While a reviewer's items await its review, a `CHANGES_REQUESTED` decision that GitHub still reports from that reviewer's earlier review does not route to `fix`; the PR node waits for the next review. Without this, an answer-only round would find the old decision and go round again.

For a declined-only round, the PR node does not post `@coderabbitai review`. On #208 that command did nothing on a commit CodeRabbit had already reviewed, and on #192 the reply in the thread was enough to bring a new review. `reviewRequest` keeps working as it does for new commits.

The wait has a limit per reviewer type, from the thread author's GraphQL type. A bot gets the PR node's review time limit, `reviewTimeoutMinutes` ("Stop waiting after (minutes)", 30 unless set), and a person `reviewThreads.personWaitHours`, 24 unless set (approved with step 8). At the limit, the items without a review go to a person (Decision 8).

When `viewerCanResolve` is false, or `resolveReviewThread` fails, the item stays `awaiting_review` with the reason, the event `github.thread_resolve_failed` names the thread, and the PR node stops waiting on it. The merge node's existing wait on unresolved threads then names it, so a person resolves it on GitHub.

### 6. A reviewer who answers back

An item that came back with the reviewer's reply goes to the coder with the whole thread. The coder answers it again:

- `settled`: the reply accepts the earlier answer. handoff resolves the thread.
- `fixed`: the reply convinced the coder. The fix goes the normal path and the item waits for the next review again.
- `declined` a second time: the item is `disputed`, and a person decides. handoff posts nothing more in the thread.
- `unclear`: handoff posts the question and waits, like a declined answer. A second `unclear` on the same item is disputed.

So a disagreement costs one extra coder round before a person sees it, and never loops.

### 7. CodeRabbit's summary comment

With `reviewThreads.summary` set to CodeRabbit's login, the PR node reads the summary comment on each look at the PR.

- It finds the comment by its first line, `<!-- This is an auto-generated comment: summarize by coderabbit.ai -->`, among the PR's issue comments by that author, paging with `listIssueComments`. The snapshot's last 50 comments can miss a comment CodeRabbit wrote first and kept editing. The row's comment id is cached on the run's first item from it.
- It takes the commit from `final_review_risk_coverage.coveredCommitId`, else from `change_assessment_commit`. The summary counts for the head commit only when that commit is the head and no review in progress block is present. Until then the reviewer has not finished with the head, and the PR node waits for it like a listed reviewer, up to the reviewer limit. At the limit it uses the latest summary, marked with the commit it covers.
- Walkthrough notes are the paragraphs after the coverage marker inside the final review risk section, without the "Merge Risk" line. Each paragraph is an item of kind `summary_note`, keyed by a hash of its whitespace-normalised text.
- Pre-merge checks are the rows of the failed checks table inside the pre-merge section, warnings and errors alike, since a check in warning mode blocks nothing on GitHub but is still a finding. Each is an item of kind `pre_merge_check`, keyed by the check's name, with the explanation and resolution from its "Full details" block rather than the cut table cells. Passed checks are not items.

The parser is `packages/github/src/coderabbit-summary.ts`, a pure function from the comment body to `{ coveredCommit, inProgress, notes, checks, problems }`. It depends on CodeRabbit's HTML comment markers, which CodeRabbit appears to use to find the sections of its own comment when it edits it. They are not documented and this plan has read them on one pull request, so the parser is defensive. A section whose markers are present but whose content does not have the expected shape becomes one item with the section's plain text and a `problems` entry, so nothing is dropped without a trace; the PR node emits `github.summary_unparsed` with the comment's link. A comment without the markers yields no items and the same event. The parser's tests run on recorded bodies, starting with #208's, and a body that breaks it becomes a new fixture.

Duplicates are left to the coder, which validated the finding anyway. A note that repeats an inline thread is answered `duplicate` with `of`, as Krister did by hand on #208. The engine dedupes only exact repeats, by key, across edits of the comment.

A summary item is answered in the round's PR comment (Decision 3). It is done (`resolved`, by `summary_dropped`) when a summary covering a later commit, or a later edit of the summary for the same commit, no longer lists it. A declined item that the next summary still lists stays `awaiting_review` and is not sent again, since the coder already answered that exact text; a reworded finding has a new key and is a new item. A fixed item that the next summary still lists goes back to the coder once, then is disputed. Summary items do not hold the merge: they block nothing on GitHub, and CodeRabbit does not write a new summary without a new commit.

A pre-merge check about the title or the description is fixed through the coder's `pr` output, which the PR node already writes to the pull request.

### 8. A person decides what handoff cannot

A disputed item, or an item whose reviewer did not review again within the limit, makes the PR node's execution wait on a question, the way a paths question does: a `questions` row with `reason: "review_items"`, wait kind `human`, and the PR's webhook key, so CI news still wakes it. One question covers all such items of the round. For each item it shows the reviewer's comments, the coder's answers and evidence, the reviewer's replies, and the fixing commit, and asks for one choice:

- Resolve: handoff resolves the thread and posts "Resolved by <person> in handoff." with the person's note when there is one.
- Send back: the item goes to the coder with the person's note, which is written to `state.decisions` as binding, the way gate decisions are.
- Leave: the item is `left`, and the person handles it on GitHub. The merge node's wait on unresolved threads covers it.

The question notifies once, like other questions, and `list_attention` and the inbox list it.

People get the same flow as bots, with the longer default limit of 24 hours. A person often resolves their own thread, which check 1 of Decision 5 records.

### 9. Settings, templates and migration

The PR node gets one setting:

```json
"reviewThreads": {
  "reply": true,
  "resolveAfterReview": true,
  "summary": "coderabbitai",
  "personWaitHours": 24,
  "maxPerRound": 20,
  "returnOnAnswerOnly": true
}
```

- `reply` turns on Decisions 2 to 4 and 6. It needs review comments sent back: turning it on in the inspector turns `sendReviewComments` on, and the compiler refuses `reply: true` with `sendReviewComments: false` (`review_threads_need_send_back`).
- `resolveAfterReview` turns on Decisions 5 and 8. It needs `reply`.
- `summary` names the bot whose summary comment is read (Decision 7); absent, none is read.
- `maxPerRound` caps the items one round sends to the coder, oldest first; the rest wait for the next round.

Without `reviewThreads` a PR node behaves as today, so existing graphs and runs do not change. The three templates wait for no reviewer and leave it off. The inspector shows a hint on a PR node that sends review comments back without `reviewThreads.reply`: comments go to the coder but nobody answers them on GitHub.

northMES's graphs (`northmes-guided` and the others) get the setting in a new graph version, through the editor or `pnpm handoff graph import`, once PR 7 is merged. Runs keep the graph version they started on, so runs already open keep today's behaviour. The assistant's page tools (`apps/web/src/lib/assistant/page-tools.ts`) learn the setting with the editor.

### 10. Dashboard and MCP

- The run page gets a review comments card while the run has items: each item's handle, file and line, reviewer, first comment, verdict, evidence, fixing commit, links to the reply and the thread, and its state, with outdated threads marked. It replaces nothing: the merge's `ReviewThreadsCard` stays for threads handoff does not manage.
- The question of Decision 8 gets its own card on the run page and in the inbox, with the two sides per item and the three choices.
- A step waiting on `re_review` reads "waiting on coderabbitai's next review (2 comments)" in the step list and the run lists.
- The inspector's Reviewers section gets the settings of Decision 9.
- `get_run` adds `review_items`: `{ id, kind, reviewer, path, line, url, verdict, evidence, commit, reply_url, state, resolved_by }` per item. `waiting_on` gains `re_review`. `answer_question` takes `items: [{ id, choice: "resolve" | "send_back" | "leave", note? }]` for a review items question and refuses an item the question does not list.

New UI is designed in Claude Design and approved before it is built. These pieces need a mock: the review comments card on the run page with every state; the review items question card, on the run page and in the inbox; the step's waiting text for `re_review`; and the inspector's review threads settings.

### 11. CodeRabbit Autopilot stays off

The summary comment offers an Autopilot checkbox that has CodeRabbit fix its findings, fix CI and resolve merge conflicts by committing to the branch. It stays off for repositories handoff works on. A CodeRabbit commit on the run's branch races handoff's `git push --force-with-lease`: the push fails, or a later push from the worktree drops CodeRabbit's commit. The README says so, and the PR node fails a rejected push with `foreign_commits`, naming the commits on the remote branch that handoff did not push and their authors, instead of a bare git error.

## Design

### Data model

- New table `review_items`: `id uuid`, `run_id` (references `runs`, cascade), `handle int` (unique per run), `key text` (unique per run: `thread:<node id>`, `review:<id>`, `note:<hash>`, `check:<name>`), `kind` (`thread`, `review_body`, `summary_note`, `pre_merge_check`), `github_id text`, `reviewer text`, `reviewer_bot boolean`, `path text`, `line int`, `body text`, `url text`, `round int`, `verdict`, `evidence text`, `fix_commit text`, `duplicate_of int`, `reply_comment_id text`, `reply_url text`, `reply_head_sha text`, `replied_at timestamptz`, `state`, `state_reason text`, `resolved_by text`, `resolved_at timestamptz`, `question_id` (references `questions`), `created_at`, `updated_at`. Enums for kind, verdict and state. One migration, generated and reviewed.
- Run state (JSON, no migration): `reviewAnswers` from the coder executor; the PR node's output feedback comments gain `item` (the handle) and `conversation`.
- `CoderOutputSchema`: `answers`, and the engine-set `answerOnly`.
- `FeedbackSchema` review comments: optional `item`, `kind` and `conversation`.

### GitHub adapter

- `pull-request.graphql`: per thread `id`, `isOutdated`, `line`, `originalLine`, `viewerCanReply`, `viewerCanResolve`, `resolvedBy { login }`, the first comment with `author { __typename login }` and `createdAt`, and `latest: comments(last: 10)` for replies. Issue comments gain `databaseId`, `createdAt` and `updatedAt`. Reviews gain the author's type. Codegen after the edit.
- `PrSnapshot.reviewThreads` gains those fields; `PrSnapshot.reviews` gains `authorBot`.
- `GitHubPort`: `replyToThread(repo, threadId, body): Promise<{ id: string; url: string }>` and `resolveThread(repo, threadId): Promise<{ resolved: boolean }>`, in `OctokitGitHub` through GraphQL and in `FakeGitHub`.
- `FakeGitHub`: thread ids, `viewerCanReply` and `viewerCanResolve` per thread, a bot flag per author, `replyInThread(number, threadId, author, body)`, `resolveThread` by id with `resolvedBy`, `deleteThread`, and `summaryComment(number, body)` that creates or edits a bot's summary comment.
- `coderabbit-summary.ts` with fixtures under `packages/github/src/fixtures/coderabbit/`.

### Engine

- `executors/external-review.ts`: items instead of findings when `reviewThreads.reply` is on, from threads, review bodies and the summary; the skip on the handoff prefix for every comment; the re-review checks of Decision 5.
- A new `executors/review-items.ts`: reading and writing `review_items`, the answer texts, posting with idempotency, resolving, and the question of Decision 8.
- `executors/github.ts`: the PR node records answers from `reviewAnswers`, posts them after the push, waits on `re_review`, applies a question's answers, and fails a push rejected by foreign commits with `foreign_commits`.
- `executors/cli-node.ts`: the validation rule in the coder prompt, `reviewAnswers` in the coder's state patch, `answerOnly`.
- `contract/checks.ts` and `contract/validate.ts`: `review_items_answered`, added to a coder attempt whose trigger is a PR node's `fix` edge that carried items.
- `scheduler/complete.ts`: the return of Decision 4 and its `edge.returned` event.
- `context.ts` and `packages/core/src/context/render.ts`: items with handles and conversations in the coder's packet, under "Review comments to answer".
- `packages/core/src/graph/compile.ts`: `review_threads_need_send_back`.

### Web and MCP

- `components/runs`: the review comments card and the review items question card (after the mocks are approved), the `re_review` waiting text.
- `components/graph-editor/inspector.tsx` and `lib/assistant/page-tools.ts`: the settings.
- `server/agent-mcp.ts`: `review_items`, `waiting_on: re_review`, `answer_question` with items. `server/step-states.ts`: the `re_review` wait. `server/attention.ts`: the question, through the existing questions path.
- `GLOSSARY.md`: Review item, Answer-only round. `README.md`: the setting, the reply format, the permissions, and Autopilot.

## Delivery

One issue, one branch and one PR per step, CI green, `pnpm doctor:react` clean after changes under `apps/web`, a red-green slice per test named here, and Context7 before code against Octokit, Drizzle, Zod, Vitest or the GitHub GraphQL API. Engine tests are integration tests with `FakeGitHub` and the Testcontainers Postgres.

1. Thread ids, replies and resolving in the GitHub adapter. Files: `queries/pull-request.graphql`, generated `gql`, `types.ts`, `octokit-client.ts`, `testing/fake-github.ts`. First tests: `octokit-client.test.ts` "getPrSnapshot maps each thread's id, outdated flag, the viewer's rights, who resolved it and its latest comments with the author's type"; "replyToThread sends addPullRequestReviewThreadReply with the thread id and body and returns the comment's id and url"; "resolveThread sends resolveReviewThread and reports whether the thread is resolved". Before merging, run both mutations once by hand against a scratch pull request with the App and with a personal token, and record the result in the PR.
2. The CodeRabbit summary parser. Files: `packages/github/src/coderabbit-summary.ts`, fixtures. First tests: `coderabbit-summary.test.ts` "finds the summary comment by its first line among a pull request's comments"; "reads the covered commit from final_review_risk_coverage, else from change_assessment_commit"; "a review in progress block marks the summary as not covering the head"; "the paragraph after the coverage marker is a walkthrough note"; "a failed check in warning mode is a finding with the explanation and resolution from its full details"; "passed checks are not findings"; "a section whose shape changed becomes one raw finding and a problem"; "a body without the markers yields no findings and a problem".
3. Review items and the coder's answers. Files: `packages/db/src/schema/review-items.ts` and a migration, `packages/core/src/schema/outputs.ts`, `render.ts`, `context.ts`, `cli-node.ts`, `contract/checks.ts`, `contract/validate.ts`. First tests: `outputs.test.ts` "answers accept fixed with a commit, declined with evidence and duplicate with of"; `render.test.ts` "the coder's packet lists each review comment with its handle, its conversation and the rule to validate it like a test"; `contract/validate.integration.test.ts` "a coder sent three items that answers two fails review_items_answered naming the third"; "a fixed answer whose commit was on the branch before the round fails"; "a coder attempt the tester sent back needs no answers"; `cli-node.integration.test.ts` (fake claude) "a coder whose answers are all declined and whose head did not move has answerOnly set by the engine".
4. The PR node answers on GitHub. Files: `executors/external-review.ts`, new `executors/review-items.ts`, `executors/github.ts`. First tests: `review-items.integration.test.ts` "a reviewer's thread becomes item R1 and reaches the coder with its handle"; "a declined answer is posted as a reply in the thread with the evidence and the hidden marker"; "a fixed answer's reply names the commit and is posted after the push"; "a PR step that restarts after posting does not post the same reply again"; "a reply handoff posted never comes back as feedback"; "review summaries, summary notes and pre-merge checks are answered in one PR comment per round"; "without reviewThreads the PR node sends findings once and posts nothing, as before".
5. Answer-only rounds return to the PR node. Files: `scheduler/complete.ts`, `executors/github.ts`. First tests: `review-items.integration.test.ts` "a round where the coder declines every comment and commits nothing goes back to the PR node with no tester, code review, gate or demo execution"; "a round with a fix goes through the tester and code review"; "a mixed round takes the normal path and posts both answers"; "with returnOnAnswerOnly false the round takes the normal path"; "the 33311b09 case: a declined CodeRabbit comment reaches the coder once, and the PR step then waits for CodeRabbit instead of going round again".
6. Re-review and resolving. Files: `executors/external-review.ts`, `executors/review-items.ts`, `executors/github.ts`, `apps/web/src/server/step-states.ts`. First tests: `review-items.integration.test.ts` "a review from the same reviewer after the reply that opens no thread on those lines resolves the thread"; "a thread is not resolved in the execution that pushed its fix, and not before a review submitted after the reply"; "a thread the reviewer resolved itself is recorded as resolved by the reviewer"; "a new thread from the reviewer on the same lines marks the old item re-raised and sends the new one to the coder"; "an old CHANGES_REQUESTED from a reviewer whose items await its review does not route to fix"; "a summary note that the next summary no longer lists is resolved; a declined one it still lists is not sent again"; "without viewerCanResolve the item keeps its state, an event names the thread, and the merge step's wait lists it"; "the step reports waiting_on re_review while items wait".
7. Disputes and the person's choice. Files: `executors/review-items.ts`, `executors/github.ts`, `scheduler/complete.ts`, `server/agent-mcp.ts`. First tests: `review-items.integration.test.ts` "a reviewer reply goes to the coder with the thread; settled resolves it"; "a second decline makes the item disputed and asks one question with both sides and the choices resolve, send back and leave"; "a bot that does not review within 30 minutes, and a person within 24 hours, makes the step ask"; "resolve resolves the thread and the run goes on"; "send back gives the coder the item with the person's note as a decision"; "leave stops handoff from touching the thread"; `agent-mcp.integration.test.ts` "answer_question takes a choice per item and refuses an item the question does not list"; "get_run lists review items with verdicts, evidence, commits, replies and states".
8. Dashboard, after the Claude Design mocks are approved. Files: `components/runs/review-items-card.tsx`, `components/runs/review-items-question.tsx`, the inbox, the step list, `components/graph-editor/inspector.tsx`, `lib/assistant/page-tools.ts`, `core/src/graph/compile.ts`. First tests: `review-items-card.test.tsx` "each item shows its handle, verdict, evidence, commit and state, and outdated threads are marked"; `review-items-question.test.tsx` "each item shows the reviewer's comments and the coder's answer, and Submit sends one choice per item"; `inspector.test.tsx` "turning on Reply to review comments turns on Send review comments back"; "a PR node that sends comments back without replies shows the hint"; `compile.test.ts` "reply without send back is refused".
9. Rollout. Files: `README.md`, `GLOSSARY.md`, the foreign commits failure in `executors/github.ts`. First test: `github.integration.test.ts` "a push rejected because the remote branch has commits handoff did not push fails with foreign_commits naming them". Then a new version of northMES's graphs with `reviewThreads` on, and the verification below.

## Risks

| Risk | Mitigation |
| --- | --- |
| CodeRabbit changes its summary comment's markup and findings are lost. | The parser turns a section it cannot read into one raw item and an event, never into nothing. Fixtures from real comments grow with each break. |
| The coder declines a valid comment with weak evidence. | The prompt asks for a command, code or a test as evidence, the reviewer sees the evidence and can answer, and a second decline goes to a person. |
| handoff resolves a thread the reviewer still disagrees with. | It resolves only after a review submitted after the answer, with no reply in the thread and no new thread on those lines. |
| Replies are noisy on a pull request with many nitpicks. | One reply per thread per round, items without a thread share one comment per round, and `maxPerRound` caps a round. |
| A reviewer acknowledgement in the thread costs a coder round to recognise as settled. | The round is answer-only, so it returns at once without tests or gates. Its cost is in the run's cost; watch it on northMES. |
| The token cannot resolve threads, and runs wait on it. | `viewerCanResolve` is read per thread; the PR node stops waiting on such an item and the merge node's wait names it. |
| A person and handoff answer the same thread. | A comment in the thread by anyone other than the reviewer and handoff makes the item `left`. |
| Answer-only rounds skip a check a graph relies on, such as a gate that always asks. | The head and the worktree are checked unchanged first, and `returnOnAnswerOnly: false` turns the return off per PR node. |

## Open questions

Krister approved the plan on 2026-10-05 with every recommended answer below, in brackets.

1. Should `reviewThreads.reply` default to on for PR nodes that already send review comments back? [No. It posts on GitHub, so it is opt-in; the inspector hint points at it.]
2. When a bot does not review again within its limit after a declined answer, should handoff ask a person or resolve the thread with a note? [Ask a person, until PR 6's response times on northMES show how often CodeRabbit stays silent.]
3. Should an `unclear` answer be posted as a question to the reviewer, or go to a person at once? [Post it to the reviewer, who wrote the comment; a second unclear goes to a person.]
4. Should a declined summary note or pre-merge check hold the merge until CodeRabbit's next summary drops it? [No. It blocks nothing on GitHub, and CodeRabbit writes no new summary without a new commit.]
5. Should the round's PR comment for items without a thread mention the reviewer (`@coderabbitai`), so it replies? [No. A mention starts a chat reply for every round; the next push brings the next summary.]
6. Should a person's manual reply in a managed thread hand the thread to the person? [Yes, `left`.]
7. Default waits for the next review. [30 minutes for a bot, 24 hours for a person.]
8. Should handoff resolve a thread whose fix made it outdated when the reviewer has not reviewed yet? [No. Outdated says the lines changed, not that the reviewer agrees.]

## Verification

1. `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm doctor:react` pass after each PR.
2. On a scratch pull request in a repository with a ruleset that requires resolved conversations, with CodeRabbit and `reviewThreads` on: a valid CodeRabbit comment is fixed, answered with the commit, and resolved after CodeRabbit's next review; an invalid one is answered with evidence, the run returns to the PR step without the tester or gates, and the thread is resolved after CodeRabbit's next review; the merge goes on without a person touching GitHub.
3. On the same pull request, reply as CodeRabbit would with a disagreement: after a second decline the inbox asks, and Resolve, Send back and Leave each do what Decision 8 says.
4. A summary comment with a failed pre-merge check and a walkthrough note that repeats a thread: both are answered in one PR comment, the note as a duplicate of the thread, and both are marked done once the next summary drops them.
5. Over MCP alone: `get_run` shows the items and their states, and `answer_question` answers a review items question.
6. With the App and with a personal token, `viewerCanResolve` is true on the run's own pull request, or the step reports why not and the merge step names the thread.
