# Writing and terminology guide

This project treats terminology as part of its public behavior. Documentation may be rewritten for clarity, but established concepts must keep their meaning and names.

## Scope

These rules apply to README files, `docs/`, user-facing strings, source comments, workflow labels, and natural-language test labels. Code identifiers follow the codebase and upstream APIs.

## Terminology

`docs/terminology.yaml` is the canonical terminology reference.

- Prefer an existing project term or an upstream DeepSeek Harness term over a new synonym.
- Keep code, configuration, command, event, and outcome identifiers literal and in backticks when used in prose. Examples include `denyOnReviewerError`, `approval/request`, `rejected`, and `unavailable`.
- Do not translate two different outcomes into the same prose label. In particular, pre-review rejection, reviewer unavailability, and delegation are distinct behaviors.
- Introduce a new term only when it names a real semantic distinction that cannot be expressed with an existing term. Add it to `docs/terminology.yaml` when it becomes part of the public vocabulary.
- Chinese documentation uses the canonical Chinese terms from `docs/terminology.yaml`; English documentation uses the canonical English terms.

The `forbidden` list in `docs/terminology.yaml` is intentionally small. It contains project-specific wording that previously caused semantic drift or unnecessary abstraction. Do not turn it into a general-purpose style blacklist.

## Prose

Describe behavior in terms of the actor, condition, action, and result. Prefer concrete statements that can be checked against implementation, configuration, or tests.

Keep one main subject per paragraph. Use headings where they help navigation, but do not manufacture extra conceptual layers merely to make a section look structured. Avoid marketing language, ornamental metaphors, repeated paragraph-end summaries, and synonyms introduced only for variety.

Do not rename an established technical concept to make a sentence sound smoother. Repetition of the correct term is preferable to lexical variety that weakens precision.

## Bilingual documentation

English and Chinese documentation must agree on behavior and concept boundaries. They do not need to be sentence-for-sentence translations. Natural phrasing is preferred as long as identifiers, conditions, limits, fallbacks, and outcomes remain equivalent.

When a behavior changes, update both language versions in the same change when both describe that behavior.

## Traceability

A public behavioral claim should be traceable to at least one of:

- implementation in `src/`;
- a configuration field or command;
- a required behavior check or other deterministic test.

If prose and implementation disagree, resolve the disagreement rather than weakening the wording until both appear compatible.

## Automated check

`scripts/check-terminology.mjs` scans the public documentation, source, tests, and workflow text for entries in the terminology file's `forbidden` list. The check is deterministic and does not score prose style or call an LLM.

Run it with:

```sh
node scripts/check-terminology.mjs
```

The same command runs in the `repository hygiene` CI job. If a forbidden phrase is genuinely required for a new meaning, update the terminology reference and explain the semantic distinction in the same change.
