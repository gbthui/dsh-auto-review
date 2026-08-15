# Writing and terminology guide

Project prose should read like ordinary engineering documentation written by someone who knows the code. Precision has priority over variety, emphasis, and rhetorical polish.

These rules apply to README files, `docs/`, package metadata, user-facing strings, source comments, workflow labels, natural-language test labels, pull-request descriptions, and release notes. Code identifiers follow the codebase and upstream APIs.

## 1. Start from the real object and behavior

Use the name of the actual object, API, process, state, or outcome. Do not replace it with a broader metaphor or a more impressive-sounding role.

A public behavioral statement should be traceable to implementation, configuration, a command, or a deterministic test. If the prose and implementation disagree, resolve the disagreement. Do not weaken the prose until both descriptions merely sound compatible.

Describe behavior with concrete actors, conditions, actions, and results. Prefer a direct statement such as “a settings read failure keeps the last known-good configuration” over a new abstraction for the same behavior.

Do not infer deployment machinery that the project does not own. For example, distinguish a running Harness profile from an operating-system service, and distinguish a settings service from the profile process itself.

## 2. Terminology is stable project vocabulary

`docs/terminology.yaml` is the canonical terminology reference.

- Prefer a project term or an upstream DeepSeek Harness term over a new synonym.
- Keep code, configuration, command, event, and outcome identifiers literal and in backticks when they appear in prose. Examples include `denyOnReviewerError`, `approval/request`, `rejected`, and `unavailable`.
- Keep semantically different outcomes separate. Pre-review `rejected`, reviewer `unavailable`, and delegation to the next answerer are different behaviors.
- Repeat the correct technical term when necessary. Do not rotate synonyms merely to avoid repetition.
- Introduce a new public term only when it names a real semantic distinction. Add the canonical English and Chinese forms to `docs/terminology.yaml` in the same change.

The `avoid_zh` and `avoid_en` entries are enforced after Markdown code spans and code blocks are removed. They are alternatives that should be replaced with the corresponding canonical term. `forbidden_zh` and `forbidden_en` are deliberately smaller and are hard failures throughout project prose.

## 3. Chinese prose

Use modern technical Chinese. Prefer ordinary multi-character words and explicit syntax over compressed literary forms.

Short declarative sentences are preferred. Instructions should state what to do and what happens. A paragraph should normally have one main subject. Use a list only when the reader benefits from scanning separate items; otherwise use prose.

Avoid single-character lexical compression when a normal modern expression says the same thing more clearly. Words such as `由`, `经`, `沿`, `与`, `即`, `均`, `且`, `见`, and `可` require review when a segmentation pass emits them as standalone lexical words. Depending on context, ordinary alternatives include `交给`, `通过`, `顺着`, `和`, `就是` or a direct statement, `都`, `并且`, `参见` or `看`, and `可以`. This is not a ban on grammatical particles or on characters that are part of a multi-character word.

Do not use a compact noun phrase where a concrete clause is clearer. If a process repeatedly restarts, describe the restart behavior instead of inventing a name for the condition. If a package is looked up in two places, describe the two lookup locations instead of naming a new “chain”.

Do not put quotation marks around ordinary concepts merely to make them look like terms. Use quotation marks for literal text, UI labels, quotations, or a term that genuinely needs to be introduced as such.

### Chinese vocabulary review

Every change to Chinese prose must be segmented before review:

```sh
npm run audit:zh -- --base origin/main
```

The command prints every unique Chinese token found in added prose, its occurrence count, whether it is a single-character token, and sample context. Canonical project terms are loaded into the segmenter dictionary before tokenization so terms such as `熔断器`, `审批结果`, and `覆盖率阈值` remain intact.

Review every emitted token. For each token other than punctuation, code identifiers, proper names, and purely grammatical particles, verify ordinary usage with web search. Do not rely on search-result counts alone. Open representative results and check how the word is actually used.

Use this source order when a term is technical:

1. the upstream project or API documentation;
2. standards or vendor documentation for the relevant technology;
3. established technical writing and documentation;
4. general web usage when no authoritative terminology exists.

For prose vocabulary that is not tied to a current API, older established usage is useful evidence because recent web text increasingly contains LLM-generated phrasing. The purpose is not to imitate old writing. It is to distinguish established Chinese from a new collocation that only sounds plausible.

A web search is evidence about usage, not an automatic verdict. A term with many results may still be wrong for this object. A rare term may be correct when it is the upstream name.

Single-character tokens deserve an explicit second pass. Keep them when they are normal grammar or the established technical wording. Replace compressed literary verbs, prepositions, conjunctions, and modifiers when an ordinary multi-character expression is clearer.

## 4. English prose

Prefer plain README and reference-documentation English: complete sentences, concrete verbs, and the shortest wording that preserves the behavior.

Use simple copular statements when they are accurate. Do not replace “is”, “uses”, or “returns” with a grander construction such as “serves as”, “stands as”, or “represents” unless the distinction matters.

When a document introduces the project, a one-sentence definition should come before broad claims about significance. Put a working example before lengthy explanation when the reader needs the example to understand the interface.

## 5. Review for common LLM writing patterns

[Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) is useful as a review checklist, not as an AI detector. The page itself says the indicators are descriptive rather than prescriptive and that individual signs are not proof of AI authorship. Apply the underlying writing concern, not a mechanical phrase ban.

Review project prose for these patterns:

- **Inflated significance.** Remove claims that a change is pivotal, crucial, foundational, transformative, or representative of a broader trend unless the statement contains a concrete fact that requires that characterization.
- **Promotional language.** Describe capabilities and limits. Do not advertise the project to itself.
- **Superficial analysis.** Remove clauses that merely restate a fact as significance, impact, confidence, robustness, or insight without adding information.
- **Invented contrast.** Constructions such as `不是……而是……`, `不仅……还……`, “not X but Y”, “not only X but also Y”, and “X rather than Y” need a real contrast already present in the subject matter. Do not invent a mistaken reader position just to create a correction.
- **Rule of three and ornamental parallelism.** Do not force three adjectives, three claims, or three similarly shaped bullets for rhythm. Use the number of items the subject actually has.
- **Elegant variation.** Repeating a technical term is better than replacing it with a sequence of near-synonyms.
- **Punched-up punctuation.** Do not use em dashes as sentence glue. Use a period, comma, colon, or parentheses according to the actual relation between clauses.
- **Mechanical emphasis.** Avoid bolding ordinary words, “key takeaways” formatting, and lists whose every item starts with a bold mini-heading plus a colon.
- **Over-sectioning.** Do not add headings that contain no prose or exist only to manufacture hierarchy. A small section does not need an opening slogan and a closing recap.
- **Canned editorial commentary.** Phrases such as `关键在于`, `归根结底`, “it is important to note”, “it is worth noting”, “overall”, or “in conclusion” need actual work to do. Delete them when the following sentence stands on its own.
- **Self-certification.** Do not call an implementation robust, safe, comprehensive, production-ready, well-designed, or clean merely because the document is describing it. State the property that can be checked.
- **Imagined objections.** Do not create an unnamed critic, reader misconception, or rhetorical question solely to answer it.
- **Paragraph-end recap.** Do not restate the paragraph’s conclusion in a final sentence unless the second statement adds a new constraint or consequence.
- **Chat residue.** User-addressing filler, offers to continue, knowledge-cutoff disclaimers, placeholder phrases, and assistant-like transition language do not belong in project documentation.

A sentence can legitimately contain one of these forms. The reviewer should ask whether the form follows from the content. The goal is ordinary technical prose, not text engineered to evade an AI detector.

## 6. Preserve information while editing style

A style pass is not permission to summarize away behavior. Preserve limits, precedence rules, fallback behavior, failure outcomes, exact identifiers, examples that establish semantics, and security boundaries.

Do not invent facts, commands, installation methods, services, compatibility claims, examples, or measurements to make a section read more smoothly. Verify a claim against the repository or an authoritative external source before adding it.

When simplifying a sentence, compare the old and new statements for lost qualifiers. Words such as “only”, “before”, “after”, “per request”, “current turn”, and exact size or count limits often carry behavior.

## 7. Bilingual documentation

English and Chinese documentation must agree on behavior and concept boundaries. They do not need to be sentence-for-sentence translations.

Keep identifiers, conditions, limits, precedence, fallback behavior, and outcomes equivalent. Let each language use its normal sentence structure. Do not preserve an awkward English construction in Chinese merely for visual symmetry, and do not invent a Chinese synonym when an established term already exists.

When both language versions describe a behavior, update both in the same change.

## 8. Review order

For a prose change, review in this order:

1. verify facts and behavior against code, configuration, tests, or authoritative sources;
2. normalize project and upstream terminology;
3. for Chinese prose, run the segmentation audit and review every token, including a second pass over single-character tokens;
4. use web search to verify the ordinary usage of vocabulary introduced or retained by the Chinese change;
5. review sentence and paragraph structure against the LLM-pattern checklist above;
6. compare English and Chinese behavior where both versions cover the same subject;
7. run the deterministic repository checks;
8. after the final content commit, request a Codex review and address or explicitly disposition every finding before merge.

Codex review is asynchronous. A green CI run does not mean the automated review has finished. Do not merge while that review is still pending on the final pull-request head.

Automated checks intentionally cover only deterministic cases. `scripts/check-terminology.mjs` rejects known terminology drift. `scripts/audit-zh-vocabulary.mjs` exposes Chinese vocabulary for review. Neither script attempts to score whether prose “sounds AI-generated”; that judgment is too context-dependent to make a reliable CI gate.
