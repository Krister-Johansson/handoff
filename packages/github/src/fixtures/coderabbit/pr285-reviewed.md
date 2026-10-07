<!-- This is an auto-generated comment: summarize by coderabbit.ai -->
<!-- review_stack_entry_start -->

<a href="https://app.coderabbit.ai/change-stack/northMES/northmes/pull/285?cs_source=review_comment"><img src="https://storage.googleapis.com/coderabbit_public_assets/review-stack-in-coderabbit-ui-dark.svg?v=2" alt="Review in Change Stack →" width="220" height="32"></a>

<!-- review_stack_entry_end -->
<!-- recent_review_start -->

No actionable comments were generated in the recent review. 🎉

<details>
<summary>ℹ️ Recent review info</summary>

<details>
<summary>⚙️ Run configuration</summary>

- **Configuration used**: Repository: northMES/northmes/.coderabbit.yaml
- **Review profile**: CHILL
- **Plan**: Advanced
- **Run ID**: `7400391e-9258-4e0f-b020-1f101b1f0cca`

</details>

<details>
<summary>📥 Commits</summary>

Reviewing files that changed from the base of the PR and between ce8f8cb142fcd199df4f4ebfc41de6abc0b5657b and aec3b86bd4a9c55bdd263e714aa686e519e2c666.

</details>

<details>
<summary>📒 Files selected for processing (3)</summary>

* `package.json`
* `test/meta/gates.test.ts`
* `test/meta/workspace.test.ts`

</details>

<details>
<summary>💤 Files with no reviewable changes (1)</summary>

* test/meta/workspace.test.ts

</details>

**Included review availability:** This review used your included allowance. Your plan provides up to 10 included reviews per hour; 1 remain after this review.

</details>

---



<!-- recent_review_end -->
<!-- walkthrough_start -->

<details>
<summary>📝 Summary</summary>

<!-- This is an auto-generated comment: release notes by coderabbit.ai -->

## Summary by CodeRabbit

* **Chores**
  * Expanded the main project check to cover linting, type checks, generation validation, and the full test suite.
  * Added separate commands for build, handoff checks, and all, unit, integration, and timezone tests.
* **Tests**
  * Added validation to check that project scripts and handoff instructions follow the expected checks and avoid directory-changing commands.

<!-- end of auto-generated comment: release notes by coderabbit.ai -->
## Walkthrough

The root `check` script now runs Node validation, Turbo lint and typecheck, generator validation, and Vitest. Additional root scripts define full checks and individual tasks. New metadata tests validate the scripts, handoff graphs, and package scripts.

<!-- change_assessment_start -->
**Priority:** ⬇️ Low



**Estimated code review effort:** 2 (Simple) | ~12 minutes

<!-- change_assessment_commit:"aec3b86bd4a9c55bdd263e714aa686e519e2c666" -->

<!-- change_assessment_end -->

</details>

<!-- walkthrough_end -->
<!-- final_review_risk_start -->
**Merge Risk:** _⚪ Minimal_ · up to `aec3b`
<!-- final_review_risk_coverage:{"sourceCommitId":"aec3b86bd4a9c55bdd263e714aa686e519e2c666","coveredCommitId":"aec3b86bd4a9c55bdd263e714aa686e519e2c666","kind":"reviewed"} -->

The root check now runs Node validation, lint, typecheck, generator check, and the full Vitest suite. No merge-blocking issues were found. The check:full, test:int, and test:tz scripts will fail until their Vitest projects are added, as the PR already notes.
<!-- final_review_risk_end -->
<!-- pre_merge_checks_walkthrough_start -->

<details>
<summary>🚥 Pre-merge checks | ✅ 5 | ❌ 1</summary>

### ❌ Failed checks (1 warning)

|      Check name     | Status     | Explanation                                                                                                                                                                                               | Resolution                                                                                                                                                                                                             |
| :-----------------: | :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linked Issues check | ⚠️ Warning | Issue `#4` requires `check:full` to run the Europe/Stockholm leg and e2e. `package.json` defines `check:full` as `pnpm check && pnpm test:tz`, so it has no e2e leg. The PR implements the Node-first `che… | Update `package.json` so `check:full` includes the e2e leg required by `#4`, in addition to `pnpm test:tz`. If the e2e leg is intentionally deferred with the e2e project, update the active issue scope before merging. |

<details>
<summary>✅ Passed checks (5 passed)</summary>

|            Check name            | Status   | Explanation                                                                                                                                                                                               |
| :------------------------------: | :------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    Out of Scope Changes check    | ✅ Passed | The changed files are `package.json`, `test/meta/gates.test.ts`, and `test/meta/workspace.test.ts`. The script changes, gate tests, graph checks, `cd` guard, and removal of the obsolete stub test dire… |
| Mit Packages Import No Agpl Code | ✅ Passed | The pull request changes only `package.json`, `test/meta/gates.test.ts`, and `test/meta/workspace.test.ts`. No changed file is under `packages/contracts`, `packages/sdk`, `packages/web-sdk`, `packages… |
| Row-Level Security On New Tables | ✅ Passed | No added or changed .sql files exist under a migrations directory in the reviewed pull request. The migration-specific RLS and CREATE POLICY rules do not apply.                                          |
|    Behaviour Change Has A Test   | ✅ Passed | PASS. The reviewed diff changes only `package.json` and test files under `test/`. No file under the scoped directories (`modules/`, `packages/`, `examples/`, `migrations/`, or `contracts/`) changed, s… |
|            Title check           | ✅ Passed | The title uses the valid non-release type `chore`, includes the `repo` scope, and accurately describes the main change: adding `pnpm check` and root scripts.                                             |

</details>

<details>
<summary>Full details: Linked Issues check</summary>

**Explanation**

Issue `#4` requires `check:full` to run the Europe/Stockholm leg and e2e. `package.json` defines `check:full` as `pnpm check &amp;&amp; pnpm test:tz`, so it has no e2e leg. The PR implements the Node-first `check` order, the root aliases and scripts, the graph checks, and the `cd` guard. The reported Node mismatch tests cover the different-major message requirement.

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
