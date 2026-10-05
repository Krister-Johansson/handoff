<!-- This is an auto-generated comment: summarize by coderabbit.ai -->
<!-- review_stack_entry_start -->

<a href="https://app.coderabbit.ai/change-stack/northMES/northmes/pull/208?cs_source=review_comment"><img src="https://storage.googleapis.com/coderabbit_public_assets/review-stack-in-coderabbit-ui-dark.svg?v=2" alt="Review in Change Stack →" width="220" height="32"></a>

Navigate logical layers of code changes, visualize relationships, and explore their blast radius.

<!-- review_stack_entry_end -->
<!-- walkthrough_start -->

<details>
<summary>📝 Summary</summary>

<!-- This is an auto-generated comment: release notes by coderabbit.ai -->

## Summary by CodeRabbit

* **Documentation**
  * Added a design decision record selecting planner-shell option A with plant breadcrumb and live-status treatment, alongside station frame S1. The variations page remains unapproved; the separate specification page is approved.
  * Updated design references and planning guidance to reflect the `ui/` and area-folder paths, per-browser theme persistence, design-project indexing, and where to find token guidance.

<!-- end of auto-generated comment: release notes by coderabbit.ai -->
## Walkthrough

The PR adds a shell variation decision record and updates design-project paths, token references, and workflow guidance. Planning documents also specify browser-local theme choice, area folders, a README index, and revised roadmap paths.


<!-- change_assessment_start -->
**Priority:** ⬇️ Low



**Estimated code review effort:** 2 (Simple) | ~8 minutes

<!-- change_assessment_commit:"501f7d04e931a6c37c0711e4c548b2c55a3bfc80" -->

<!-- change_assessment_end -->

</details>

<!-- walkthrough_end -->
<!-- final_review_risk_start -->
**Merge Risk:** _🔵 Low_ · up to `501f7`
<!-- final_review_risk_coverage:{"sourceCommitId":"501f7d04e931a6c37c0711e4c548b2c55a3bfc80","coveredCommitId":"501f7d04e931a6c37c0711e4c548b2c55a3bfc80","kind":"reviewed"} -->

The workflow still directs authors to link committed design images, but its explanation of the attachment limitation is inaccurate. Correct the rationale to reflect the repository’s commit-first requirement.
<!-- final_review_risk_end -->
<!-- architecture_review_start -->
### Architecture Summary

**Architecture risk:** _🔵 Low_ · up to `501f7`

The change affects 1 system.

**Changed systems:** `docs`

**Architecture concerns**
No architecture-level concerns identified.


<!-- architecture_review_end -->
<!-- pre_merge_checks_walkthrough_start -->

<details>
<summary>🚥 Pre-merge checks | ✅ 5 | ❌ 1</summary>

### ❌ Failed checks (1 warning)

|  Check name | Status     | Explanation                                                                                                                                                                                               | Resolution                                                                                                                                                                                                                                        |
| :---------: | :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Title check | ⚠️ Warning | The title matches the documentation changes, but it does not meet the release-note rule. The `docs` type does not reach the changelog, and the description names repository organization rather than an … | If this change has a user-visible outcome, use a changelog type such as `feat`, `fix`, `security`, `perf`, or `revert` and state that outcome in the title. If it has no user-visible outcome, confirm that a release-note title is not required… |

<details>
<summary>✅ Passed checks (5 passed)</summary>

|            Check name            | Status   | Explanation                                                                                                                                                                                               |
| :------------------------------: | :------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|        Linked Issues check       | ✅ Passed | Check skipped because no linked issues were found for this pull request.                                                                                                                                  |
|    Out of Scope Changes check    | ✅ Passed | Check skipped because no linked issues were found for this pull request.                                                                                                                                  |
| Mit Packages Import No Agpl Code | ✅ Passed | The check passes. The changed-file inventory contains only files under `docs/design/` and `docs/plan/`. No file changed in the specified package or module-contract scope, so this pull request adds no … |
| Row-Level Security On New Tables | ✅ Passed | No migration files or other .sql files changed in this PR. The check passes because it applies only to changed SQL files under migrations directories.                                                    |
|    Behaviour Change Has A Test   | ✅ Passed | PASS. The changed-file inventory contains only files under `docs/design/` and `docs/plan/`. No changed file is in the check's scope, so the test-file requirement does not apply.                         |

</details>

<details>
<summary>Full details: Title check</summary>

**Explanation**

The title matches the documentation changes, but it does not meet the release-note rule. The `docs` type does not reach the changelog, and the description names repository organization rather than an outcome for users.

**Resolution**

If this change has a user-visible outcome, use a changelog type such as `feat`, `fix`, `security`, `perf`, or `revert` and state that outcome in the title. If it has no user-visible outcome, confirm that a release-note title is not required for this documentation-only change.

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
