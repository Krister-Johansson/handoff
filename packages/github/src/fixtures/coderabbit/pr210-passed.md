<!-- This is an auto-generated comment: summarize by coderabbit.ai -->
<!-- review_stack_entry_start -->

<a href="https://app.coderabbit.ai/change-stack/northMES/northmes/pull/210?cs_source=review_comment"><img src="https://storage.googleapis.com/coderabbit_public_assets/review-stack-in-coderabbit-ui-dark.svg?v=2" alt="Review in Change Stack →" width="220" height="32"></a>

Navigate logical layers of code changes, visualize relationships, and explore their blast radius.

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
- **Run ID**: `377be059-5dac-4620-b2e7-a1fb5fcbef4a`

</details>

<details>
<summary>📥 Commits</summary>

Reviewing files that changed from the base of the PR and between 52038214bac51f8beec670d3bd10e27d4d6af777 and 8576f55ebb9535af37f58a32b75dda50c65a302d.

</details>

<details>
<summary>📒 Files selected for processing (1)</summary>

* `.coderabbit.yaml`

</details>

**Included review availability:** This review used your included allowance. Your plan provides up to 10 included reviews per hour; 7 remain after this review.

</details>

---



<!-- recent_review_end -->
<!-- walkthrough_start -->

<details>
<summary>📝 Summary</summary>

<!-- This is an auto-generated comment: release notes by coderabbit.ai -->

## Summary by CodeRabbit

* **Documentation**
  * Clarified release-note guidance to distinguish user-visible changes from changes that do not require a release note.
  * The guidance identifies which change categories are expected to appear in release notes and retains the existing commit format and breaking-change notation requirements.
  * No product features or user-facing behavior changed.

<!-- end of auto-generated comment: release notes by coderabbit.ai -->
## Walkthrough

The `.coderabbit.yaml` title guidance distinguishes changelog-visible commit types from non-changelog types. It states that non-user-visible changes do not need a release note and retains the breaking-change and outcome-description requirements.


<!-- change_assessment_start -->
**Priority:** ⬇️ Low



**Estimated code review effort:** 1 (Trivial) | ~5 minutes

<!-- change_assessment_commit:"8576f55ebb9535af37f58a32b75dda50c65a302d" -->

<!-- change_assessment_end -->

</details>

<!-- walkthrough_end -->
<!-- final_review_risk_start -->
**Merge Risk:** _⚪ Minimal_ · up to `8576f`
<!-- final_review_risk_coverage:{"sourceCommitId":"8576f55ebb9535af37f58a32b75dda50c65a302d","coveredCommitId":"8576f55ebb9535af37f58a32b75dda50c65a302d","kind":"reviewed"} -->

The updated guidance allows non-changelog titles for changes without user-visible outcomes while preserving release-note guidance for changelog changes. No merge-blocking issue is identified.
<!-- final_review_risk_end -->
<!-- architecture_review_start -->
### Architecture Summary

**Architecture risk:** _🔵 Low_ · up to `8576f`

The changed surface does not map to a changed system, dependency edge, entrypoint, or external dependency.

**Changed systems:** None identified.

**Architecture concerns**
No architecture-level concerns identified.


<!-- architecture_review_end -->
<!-- pre_merge_checks_walkthrough_start -->

<details>
<summary>🚥 Pre-merge checks | ✅ 6</summary>

<details>
<summary>✅ Passed checks (6 passed)</summary>

|            Check name            | Status   | Explanation                                                                                                                                                                                               |
| :------------------------------: | :------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|        Linked Issues check       | ✅ Passed | Check skipped because no linked issues were found for this pull request.                                                                                                                                  |
|    Out of Scope Changes check    | ✅ Passed | Check skipped because no linked issues were found for this pull request.                                                                                                                                  |
| Mit Packages Import No Agpl Code | ✅ Passed | The check passes. The PR changes only `.coderabbit.yaml`. No files changed under the specified package or module contract paths, so it adds no prohibited imports, re-exports, or dependencies and chang… |
| Row-Level Security On New Tables | ✅ Passed | The row-level security check passes. The PR diff changes only `.coderabbit.yaml` and contains no added or changed `.sql` files under a migrations directory.                                              |
|    Behaviour Change Has A Test   | ✅ Passed | The Behaviour change has a test rule passes. The PR changes only `.coderabbit.yaml`. No changed file is in the rule's `modules/`, `packages/`, `examples/`, `migrations`, or `contracts` scope.           |
|            Title check           | ✅ Passed | The title follows the required Conventional Commit format. The chore(repo) type is appropriate for this non-user-visible change, and the title describes the update to CodeRabbit's title check.          |

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
