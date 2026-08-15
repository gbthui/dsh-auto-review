# dsh-auto-review

English | [中文](README.zh.md)

dsh-auto-review is a DeepSeek Harness plugin that uses a reviewer model to answer approval requests. Its behavior is similar to Codex's `approvals_reviewer = "auto_review"`: when an agent requests an operation that the sandbox does not permit, usually a sandbox escalation, the reviewer decides first. Requests not answered by the plugin continue to interactive approval.

The plugin does not change sandbox configuration. It only handles approval requests.

## Install

Install Node.js and make sure pnpm is on PATH, then add the plugin to the web profile:

```bash
npx @deepseek-ai/dsh plugin --profile web add https://github.com/gbthui/dsh-auto-review.git
```

`dsh plugin` installs the package through pnpm and adds it to the profile's bundle configuration. The plugin is enabled by default and uses the current session model as its reviewer, so no settings change is required.

A newly installed bundle is loaded the next time the profile starts. If the web profile is already running, stop that process and start it again using the same launch method. The npm launch command documented by DeepSeek Harness is:

```bash
npx @deepseek-ai/dsh web
```

Start a new session and run `/auto-review status` to verify it. See the [deployment guide](./docs/deployment.md) for other profiles, file/registry installs, and manual setup.

## Configuration

Configuration is only needed when you want a separate reviewer. For example, to use an OpenAI-compatible endpoint:

```yaml
# ~/.dsh/settings.yaml
dsh-auto-review:
  reviewer:
    baseURL: https://api.deepseek.com/v1
    model: deepseek-v4-flash
    apiKeyFile: ~/.dsh/reviewer.env   # KEY=VALUE file; apiKey / apiKeyEnv also work
    thinking: off
```

See the [configuration reference](./docs/configuration.md) for all options.

## How it works

```
agent attempts an operation the sandbox does not permit
        |
        v
harness requests approval
        |
        v
dsh-auto-review answers first
        +-- allow -> allowed-once -> retry the operation
        +-- deny  -> rejected     -> return the denial to the agent
```

## Features

The plugin registers as the first answerer for `approval/request`. Escalation requests reach the reviewer first, and each grant applies only to the current request.

The reviewer receives the pending request, your user messages, the agent's recent activity, and summaries of tool results. Only user messages in reviewer context can authorize an action. The agent's chain of thought is not sent to the reviewer. Raw tool output is omitted by default; `rawToolResults: true` explicitly includes capped raw tool-result text.

Integrity failures such as an unresolved exact tool call, an oversized pending request, or a latest user authorization that exceeds the context budget are `rejected` without reviewer execution. Reviewer errors return `unavailable` by default. Setting `denyOnReviewerError: false` delegates reviewer errors to the next answerer. Malformed reviewer output gets one corrective retry; a second parse failure follows the same reviewer-error handling.

`allowRules` can grant requests without review by exact tool name and literal operation prefix. A rule can grant a `workspace-write` escalation only when that target is declared explicitly. `danger-full-access` cannot be granted through `allowRules`.

The circuit breaker is scoped to the current turn. With the defaults, it triggers after three consecutive denials or ten denials among the latest fifty approval outcomes observed by the breaker. `allow` and `unavailable` break a consecutive denial streak; reviewer unavailability does not count as a denial.

Every decision is written to `~/.dsh/auto-review-audit.jsonl`. Tool inputs are stored as sha256 hashes by default. Set `includeToolInput` to true to store the original input.

`/approve N` displays the tool, directory, complete arguments, and fingerprint for a denied action. Displaying a record does not authorize anything. `/approve N confirm` permits one retry of that exact action after the record has been displayed. The retry still passes through the reviewer.

## Documentation

- [Deployment Guide](./docs/deployment.md) · [部署指南](./docs/deployment.zh.md)
- [Configuration Reference](./docs/configuration.md) · [配置参考](./docs/configuration.zh.md)

## Tests

`npm test` runs the deterministic source tests through `test/run-tests.ts`. The runner executes `test/units.test.ts`, the domain behavior suites under `test/behavior/`, `test/pipeline.test.ts`, and `test/policy-cases.test.ts`. Live policy cases remain environment-gated and are skipped when no reviewer endpoint is configured.

`test/behavior/contract.ts` lists the required behaviors that CI must observe as executed and passing. The contract covers the documented approval path, reviewer-error handling, evidence boundaries, fact finding, circuit breaker, audit behavior, live configuration, and commands. This is separate from numeric code coverage so an aggregate percentage cannot hide the loss of a documented fallback or safety path.

`npm run test:coverage` runs the same deterministic suite under c8/V8 coverage. CI requires at least 95% statements, 85% branches, 100% functions, and 95% lines across `src/**/*.ts`, including source files not loaded by a test. Text, JSON summary, and LCOV reports are generated under `coverage/`.

`test/policy-matrix.test.ts` runs the adversarial policy corpus for N rounds and records TP/FP/TN/FN. The default is 30 rounds per case. `AR_MATRIX_ROUNDS` changes the count, and `AR_MATRIX_FAIL_ON_FALSE_ALLOW=1` makes a false allow fail the test.

`npm run test:e2e` runs the Cordis/AgentLoop E2E path: sandbox denial, `approval/request`, reviewer `allowed-once`, retry execution, and reviewer denial. It requires the explicit `AR_E2E_API_KEY` environment variable. `AR_E2E_BASE_URL` and `AR_E2E_MODEL` are optional. Tests run directly on the TypeScript source through tsx.

## Development

The code is TypeScript with strict mode and erasable-only syntax enabled. The package entry is compiled into `lib/` by `npm run build`. `lib/` is committed, so git installs do not need a build step. Registry publishing runs the build through `prepack`.

Node does not type-strip source files under `node_modules`, so a source-only package entry breaks profiles installed with pnpm. Tests run through tsx.

The security boundary is split across `src/` modules. `index.ts` is the entry point. `policy` contains the reviewer policy; `evidence` handles trusted and untrusted context and authorization completeness; `facts` provides read-only fact tools; `reviewer` handles model calls and verdict parsing; `approval-answerer` contains the decision path and `/approve` records; `breaker` implements the circuit breaker; `audit` writes JSONL records; `config` defines the schema; and `util` contains small helpers.

```bash
npm install
npm run typecheck
npm test
npm run test:coverage
```

The test suite also imports DeepSeek Harness packages. CI installs the pinned Harness 0.1.0-rc.6 test package set from npm. For local development, install the matching packages without saving them to this package, or link them from a matching Harness checkout. The exact package set used by CI is in `.github/workflows/ci.yml`.

## License

Apache-2.0. See [LICENSE](./LICENSE).
