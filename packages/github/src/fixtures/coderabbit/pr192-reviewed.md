<!-- This is an auto-generated comment: summarize by coderabbit.ai -->
<!-- review_stack_entry_start -->

<a href="https://app.coderabbit.ai/change-stack/northMES/northmes/pull/192?cs_source=review_comment"><img src="https://storage.googleapis.com/coderabbit_public_assets/review-stack-in-coderabbit-ui-dark.svg?v=2" alt="Review in Change Stack →" width="220" height="32"></a>

Navigate logical layers of code changes, visualize relationships, and explore their blast radius.

<!-- review_stack_entry_end -->
<!-- walkthrough_start -->

<details>
<summary>📝 Summary</summary>

<!-- This is an auto-generated comment: release notes by coderabbit.ai -->

## Summary by CodeRabbit

* **Chores**
  * Standardized the project’s development runtime on Node.js 26.
  * Added workspace configuration and automated checks for repository and package metadata.
  * Updated repository exclusions for generated build output and local environment files.

<!-- end of auto-generated comment: release notes by coderabbit.ai -->
## Walkthrough

The root now defines a pnpm workspace, Node.js version pins, and a Vitest unit project. Metadata tests check workspace settings, package licenses, tool versions, and selected repository tracking rules.


<!-- change_assessment_start -->
**Priority:** ⬇️ Low







**Estimated code review effort:** 2 (Simple) | ~12 minutes

<!-- change_assessment_commit:"3467df93de28f06c124bca36031c5f63a6194b19" -->

<!-- change_assessment_end -->

</details>

<!-- walkthrough_end -->
<!-- final_review_risk_start -->
**Merge Risk:** _🔵 Low_ · up to `3467d`
<!-- final_review_risk_coverage:{"sourceCommitId":"3467df93de28f06c124bca36031c5f63a6194b19","coveredCommitId":"3467df93de28f06c124bca36031c5f63a6194b19","kind":"reviewed"} -->

The workspace is mergeable with a bounded follow-up: add TSX unit-test selection before relying on pnpm check to run those tests.
<!-- final_review_risk_end -->
<!-- architecture_review_start -->
### Security Architecture Review

**Security architecture risk:** _🔵 Low_ · up to `3467d`

The change is limited to workspace setup and metadata validation. It does not demonstrate a new externally reachable attack path or increased service privileges. Dependency-build refusals are declared, but their enforcement during installation and recovery is not established by the metadata tests.

**Retained concerns**
No architecture-level concerns identified.


<!-- architecture_review_end -->
<!-- pre_merge_checks_walkthrough_start -->

<details>
<summary>🚥 Pre-merge checks | ✅ 4 | ❌ 2</summary>

### ❌ Failed checks (2 warnings)

|      Check name     | Status     | Explanation                                                                                                                                                                                               | Resolution                                                                                                                                                                                                                                        |
| :-----------------: | :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Linked Issues check | ⚠️ Warning | [ `#3` ] The workspace globs, strict catalog, build refusals, Node 26 files, unit Vitest project, and workspace tests are included. The issue also requires `turbo.json`, `biome.json`, and `tsconfig.base… | Add `turbo.json`, `biome.json`, and `tsconfig.base.json` with the settings required by `#3`, then pass the Biome check. Provide evidence that `pnpm install --frozen-lockfile` succeeds in a fresh clone. The excluded `pnpm-lock.yaml` must be av… |
|     Title check     | ⚠️ Warning | The title describes the workspace setup, but it uses `chore`, which does not reach the changelog, and describes implementation work rather than an outcome for users.                                     | Replace the title with a changelog-eligible Conventional Commit type and state the concrete user-facing outcome. If this change has no user-facing outcome, confirm that infrastructure-only pull requests are exempt from the release-note titl… |

<details>
<summary>✅ Passed checks (4 passed)</summary>

|            Check name            | Status   | Explanation                                                                                                                                                                                               |
| :------------------------------: | :------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    Out of Scope Changes check    | ✅ Passed | The changed root manifest, workspace configuration, Node version files, Vitest configuration, metadata tests, ignore rules, and lockfile all support the workspace setup in [`#3`]. No unrelated change is… |
| Mit Packages Import No Agpl Code | ✅ Passed | The changed-file inventory contains no files under packages/contracts, packages/sdk, packages/web-sdk, packages/ui, packages/web-build, packages/testing, or modules/*/contracts. The custom check passe… |
| Row-Level Security On New Tables | ✅ Passed | The changed-file inventory contains no SQL files under a migrations directory. The row-level security check does not apply to this pull request.                                                          |
|    Behaviour Change Has A Test   | ✅ Passed | No changed files fall within the Behaviour change has a test scope. The PR changes only root configuration, the lockfile, and test/meta/workspace.test.ts. The check passes because the scoped-change co… |

</details>

<details>
<summary>Full details: Linked Issues check</summary>

**Explanation**

[ `#3` ] The workspace globs, strict catalog, build refusals, Node 26 files, unit Vitest project, and workspace tests are included. The issue also requires `turbo.json`, `biome.json`, and `tsconfig.base.json`; the PR description confirms these files are absent. The required Biome check is therefore not met. The fresh-clone frozen-install criterion is also unverified. `pnpm-lock.yaml` is excluded from review, and the reported install used the current checkout, not a fresh clone.

**Resolution**

Add `turbo.json`, `biome.json`, and `tsconfig.base.json` with the settings required by `#3`, then pass the Biome check. Provide evidence that `pnpm install --frozen-lockfile` succeeds in a fresh clone. The excluded `pnpm-lock.yaml` must be available for review if its contents are needed to establish that result.

</details>

<details>
<summary>Full details: Title check</summary>

**Resolution**

Replace the title with a changelog-eligible Conventional Commit type and state the concrete user-facing outcome. If this change has no user-facing outcome, confirm that infrastructure-only pull requests are exempt from the release-note title rule.

</details>

</details>

<!-- pre_merge_checks_walkthrough_end -->
<!-- autopilot:start -->
- [ ] <!-- {"checkboxId":"2708ad07-9f24-4260-9c11-7dc76a49f2e3"} --> <strong title="Keep fixing CodeRabbit findings and required CI, and resolving merge conflicts">Autopilot</strong> · Keep fixing CodeRabbit findings and required CI, and resolving merge conflicts
<!-- autopilot:end -->
<!-- tips_start -->

---




<sub>Comment `@coderabbitai help` to get the list of available commands.</sub>

<!-- tips_end -->
