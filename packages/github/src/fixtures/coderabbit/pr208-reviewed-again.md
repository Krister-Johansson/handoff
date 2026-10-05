<!-- This is an auto-generated comment: summarize by coderabbit.ai -->
<!-- review_stack_entry_start -->

<a href="https://app.coderabbit.ai/change-stack/northMES/northmes/pull/208?cs_source=review_comment"><img src="https://storage.googleapis.com/coderabbit_public_assets/review-stack-in-coderabbit-ui-dark.svg?v=2" alt="Review in Change Stack →" width="220" height="32"></a>

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
- **Run ID**: `f316afc9-94ce-4874-8611-5733100f705f`

</details>

<details>
<summary>📥 Commits</summary>

Reviewing files that changed from the base of the PR and between 501f7d04e931a6c37c0711e4c548b2c55a3bfc80 and 94c0c6c82ff9dd2d62748249e5ad75a11c615908.

</details>

<details>
<summary>📒 Files selected for processing (1)</summary>

* `docs/plan/13-delivery-and-github.md`

</details>

<details>
<summary>🚧 Files skipped from review as they are similar to previous changes (1)</summary>

* docs/plan/13-delivery-and-github.md

</details>

**Included review availability:** This review used your included allowance. Your plan provides up to 10 included reviews per hour; 8 remain after this review.

</details>

---



<!-- recent_review_end -->
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

<!-- change_assessment_commit:"94c0c6c82ff9dd2d62748249e5ad75a11c615908" -->

<!-- change_assessment_end -->

</details>

<!-- walkthrough_end -->
<!-- final_review_risk_start -->
**Merge Risk:** _⚪ Minimal_ · up to `94c0c`
<!-- final_review_risk_coverage:{"sourceCommitId":"94c0c6c82ff9dd2d62748249e5ad75a11c615908","coveredCommitId":"94c0c6c82ff9dd2d62748249e5ad75a11c615908","kind":"reviewed"} -->

The updated design workflow guidance has no identified merge-blocking issue.
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
| Title check | ⚠️ Warning | The title follows the `type(module):` format and relates to the changes. However, `docs` is not listed as a changelog-reaching type, and the title describes design-file organization rather than a user… | For this documentation-only pull request, add an approved exception for `docs` titles to the title requirements. Otherwise, use a changelog-reaching type only if the pull request includes a real user-visible outcome, and state that outcome … |

<details>
<summary>✅ Passed checks (5 passed)</summary>

|            Check name            | Status   | Explanation                                                                                                                                                                                               |
| :------------------------------: | :------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|        Linked Issues check       | ✅ Passed | Check skipped because no linked issues were found for this pull request.                                                                                                                                  |
|    Out of Scope Changes check    | ✅ Passed | Check skipped because no linked issues were found for this pull request.                                                                                                                                  |
| Mit Packages Import No Agpl Code | ✅ Passed | The MIT packages import no AGPL code check passes. The PR changes only files under `docs/design` and `docs/plan`; no files changed in the specified package or module contract paths.                     |
| Row-Level Security On New Tables | ✅ Passed | No migration changed in the pull request. The changed-file inventory contains only design documentation and image files, with no added or changed `.sql` files under a migrations directory. The row-lev… |
|    Behaviour Change Has A Test   | ✅ Passed | The check passes. The PR changes only files under docs/design/ and docs/plan/. No changed file is in the modules/, packages/, examples/, migrations, or contracts scope. The test-file condition does no… |

</details>

<details>
<summary>Full details: Title check</summary>

**Explanation**

The title follows the `type(module):` format and relates to the changes. However, `docs` is not listed as a changelog-reaching type, and the title describes design-file organization rather than a user outcome. It does not meet the release-note rule.

**Resolution**

For this documentation-only pull request, add an approved exception for `docs` titles to the title requirements. Otherwise, use a changelog-reaching type only if the pull request includes a real user-visible outcome, and state that outcome in the title.

</details>

</details>

<!-- pre_merge_checks_walkthrough_end -->
<!-- autopilot:start -->
- [ ] <!-- {"checkboxId":"2708ad07-9f24-4260-9c11-7dc76a49f2e3"} --> <strong title="Keep fixing CodeRabbit findings and required CI, and resolving merge conflicts">Autopilot</strong> · Stopped
<!-- autopilot:end -->
<!-- tips_start -->

---




<sub>Comment `@coderabbitai help` to get the list of available commands.</sub>

<!-- tips_end -->
