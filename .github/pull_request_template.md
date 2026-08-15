## Summary

<!-- State what changed and which behavior or documentation surface it affects. -->

## Verification

<!-- List the checks actually run. -->

## Writing review

Complete the applicable items. Delete items that do not apply.

- [ ] Public claims are traceable to implementation, configuration, tests, or an authoritative external source.
- [ ] Existing project and upstream terminology is preserved; new public terms are added to `docs/terminology.yaml`.
- [ ] Exact identifiers, limits, precedence rules, fallback behavior, and outcomes were not summarized away.
- [ ] Prose was reviewed against `docs/writing-guide.md`, including the LLM-writing-pattern checklist.
- [ ] No new marketing language, ornamental contrast, forced parallelism, synonym rotation, unnecessary quotation marks, or paragraph-end recap was introduced.
- [ ] If Chinese prose changed, `npm run audit:zh -- --base origin/main` was run and every emitted token was reviewed.
- [ ] If Chinese prose changed, non-trivial tokens were checked with web search for established usage; single-character lexical tokens received a second pass and were replaced where ordinary multi-character wording is clearer.
- [ ] If both English and Chinese documents cover the changed behavior, their identifiers, conditions, limits, fallback behavior, and outcomes still agree.
- [ ] After the final content commit, Codex review was requested and every finding was addressed or explicitly dispositioned before merge.
