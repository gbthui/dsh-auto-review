# Configuration Reference

Configuration lives under `dsh-auto-review:` in the settings document. Most changes apply immediately without a restart. The minimum configuration is the master switch:

```yaml
dsh-auto-review:
  enabled: true
```

## Full configuration

```yaml
dsh-auto-review:
  enabled: true                      # master switch

  reviewer:
    baseURL: ''                      # '' = use the agent's current model
    model: ''                        # model id on the endpoint path
    apiKey: ''                       # key option 1: inline (redacted in UIs)
    apiKeyEnv: ''                    # key option 2: read from an env var
    apiKeyFile: ''                   # key option 3: KEY=VALUE file (~ expanded; recommended)
    timeoutMs: 24000
    maxTokens: 1024                  # a verdict JSON is ~100-300 tokens; the cap guards runaway output
    thinking: default                # default | off; off depends on the reviewer call path
    extraSystemPrompt: ''            # extra rules appended to the reviewer's policy
    factFinding:
      enabled: true                  # the reviewer may ask a few local questions first
      maxRounds: 2                   # reviewer -> facts -> reviewer round trips
      maxFacts: 3                    # total fact queries per ask
      content:
        enabled: false               # reading file content: off by default; external endpoints require explicit opt-in
        maxBytes: 4096

  policy:
    tools: []                        # empty = review every ask; a list = only these tools
    allowRules: []                   # direct no-review allow rules; see below
    maxInputChars: 16000             # oversized requests are denied, never truncated
    denyOnReviewerError: true        # reviewer unreachable -> fail closed
    context:
      enabled: true                  # the context sent to the reviewer
      maxMessages: 10
      maxChars: 6000
      rawToolResults: false          # false = tool results as a short summary (length + sha256)

  breaker:
    enabled: true
    consecutiveDenyLimit: 3
    windowSize: 50
    windowDenyLimit: 10              # or 10 denials in 50 reviews
    action: cancel                   # cancel | inject | off

  audit:
    enabled: true
    path: ~/.dsh/auto-review-audit.jsonl
    includeToolInput: false          # inputs are sha256-hashed unless you turn this on
```

## Choosing a reviewer

### Use the agent's current model

Leave `baseURL` empty to use the agent's current model as the reviewer. The harness supplies its existing credentials, so no endpoint or key configuration is required.

In this configuration, the agent and reviewer use the same model. They can make the same interpretation error on the same user instruction. Interactive use still has the human approval path available; unattended deployments should use a separate reviewer.

### Use a separate endpoint

Set `baseURL` to an OpenAI-compatible `chat/completions` endpoint and configure `model` and a key. For unattended deployments, use a reviewer from a different provider or model family than the agent when possible.

An external endpoint receives the reviewer policy, the pending request's tool name and raw arguments, user messages, recent agent activity, summaries of tool results, the workspace path, and the sandbox mode. File content is not sent by default. It is included only when `factFinding.content.enabled` is enabled and the reviewer requests `inspect_text_file`.

Tool arguments can contain sensitive values such as paths, URLs, or code. Configure an endpoint that is permitted to receive that data.

Keys are resolved in this order: `apiKey` → `apiKeyEnv` → `apiKeyFile`. `apiKeyEnv` reads a process environment variable. `apiKeyFile` reads the first `NAME=value` line and does not accept quotes or `export`. If no key resolves, the reviewer call fails and the request follows fail-closed behavior.

## thinking

`thinking` only controls whether the reviewer request tries to disable reasoning. It does not affect how authorization is interpreted. Leave it at the default unless you specifically want to disable reviewer reasoning:

```yaml
dsh-auto-review:
  reviewer:
    thinking: off
```

`default` sends no extra reasoning-control parameter and leaves the behavior to the model or provider. The effect of `off` depends on how the reviewer is called:

- When `reviewer.baseURL` is configured, the plugin calls `${baseURL}/chat/completions` directly and adds `thinking: { type: disabled }` to the request body. This is a DeepSeek extension. If the endpoint does not accept that field, keep `thinking: default`; otherwise the reviewer request may fail.
- When `reviewer.baseURL` is empty, the reviewer follows the current session model. If the current provider is `deepseek-official`, `off` is passed through the harness LLM layer as `reasoningEffort: off`.
- When the reviewer follows a session model from another provider, the plugin currently sends no additional reasoning override, so that provider keeps its default behavior.

In every case, allow/deny is read only from the reviewer's final text answer. Chain-of-thought, reasoning blocks, and `reasoning_content` are never treated as authorization.

## Policy

### Requests visible to the reviewer

The reviewer handles only approval requests that can be matched to an exact tool call. The request's `callId` must match a `tool/call` event. If it cannot be matched, the request is denied. An approval request without a `callId` is not treated as a tool request and continues to the human answerer.

`maxInputChars` limits the pending request itself. An oversized request is denied before the reviewer is called. The latest user message is never truncated because its later text may narrow or revoke authorization. If that message cannot fit within the context budget, the request follows fail-closed behavior.

Reviewer context is divided into trusted and untrusted input. Only user messages can authorize an action. Assistant text, tool calls, and tool results provide event context only. Tool results can contain prompt injection, so the default context includes only their length and sha256 summary. Newer user messages take precedence over older ones; a later revocation or narrowing overrides earlier authorization. Older messages that exceed the context budget are represented by sha256-only placeholders, which cannot authorize actions.

### Allow rules

`allowRules` is a direct allow path that runs before the reviewer. A matching request immediately returns `allowed-once`; the reviewer is not called. Only put operations here that you are willing to approve automatically.

For example, this rule applies only to plain approval requests for the `bash` tool and allows operation strings that begin with `git status` or `git diff`:

```yaml
dsh-auto-review:
  policy:
    allowRules:
      - tool: bash
        operations:
          - "git status"
          - "git diff"
        escalationTarget: ''
```

`tool` must exactly match the actual tool name. `operations` checks the tool arguments in the order `command`, `operation`, then `script`, takes the first string field it finds, and performs a literal string-prefix match. There is no shell parsing and no token boundary. For example, `git status` also matches `git status --short`, so avoid broad prefixes such as `git`.

`escalationTarget: ''` makes the rule plain-approval only, meaning the tool arguments do not contain a non-empty `sandbox_permissions`. A plain rule may omit `operations` or leave it empty, but doing so allows every plain approval request for that exact tool, including calls with no `command`, `operation`, or `script` field. Leave it empty only when that is actually what you want.

To allow a `workspace-write` escalation, define a separate escalation rule:

```yaml
dsh-auto-review:
  policy:
    allowRules:
      - tool: bash
        operations:
          - "mkdir -p ./dist"
        escalationTarget: workspace-write
```

This rule matches only requests with `sandbox_permissions: workspace-write`, and the operation string must begin with one of the listed prefixes. It does not match plain approvals. Escalation rules must have at least one operation prefix. `escalationTarget` may only be empty or `workspace-write`, so `danger-full-access` cannot be granted through `allowRules`. Regular expressions are not supported.

If no rule matches, the request continues to the reviewer. One ordering detail also matters: when `policy.tools` is non-empty, the plugin filters by that list first. A tool not listed in `policy.tools` never reaches either `allowRules` or the reviewer.

### Failure handling

`denyOnReviewerError: true` is the default. If the reviewer is unavailable, the result is `unavailable` and the request fails closed. Set it to `false` to pass these requests to the human answerer.

An unparsable reviewer verdict gets one corrective retry. If the second result also cannot be parsed, the request fails closed. A `critical` request cannot be allowed by the reviewer; an allow verdict on a critical request is converted to deny.

The circuit breaker counts within the current turn. Three consecutive denials, or ten denials among the latest fifty reviews, cancel the turn. Reviewer outages do not count as denials. Any non-denial resets the consecutive counter, so `deny → unavailable → deny → deny` has a consecutive count of two.

### Fact finding

The reviewer can return `need_fact` to request local information before issuing a verdict. Across `maxRounds` round trips, it may make at most `factFinding.maxFacts` queries. Available tools are fixed: `inspect_path`, `inspect_directory`, `inspect_file_metadata`, `inspect_git_remote`, `inspect_git_status`, and, when enabled, `inspect_text_file`. Credentials are stripped from `inspect_git_remote` results.

These tools are restricted to the workspace. Paths are checked with realpath containment. Requests outside the workspace are refused without returning metadata such as whether a file exists. The queries do not use a shell, network access, or escalation. The only subprocess is git, run with fsmonitor disabled and an empty `hooksPath`.

`inspect_text_file` is the only fact-finding tool that can send workspace file content to the reviewer, and it is disabled by default. When enabled, it remains workspace-scoped and refuses binary files, files over `maxBytes`, and known sensitive paths including `.env`, `.ssh/`, `.aws/`, `.kube/`, `.npmrc`, `.pypirc`, `.docker/`, `credentials.*`, `secrets.*`, and key material. A static path list cannot identify every sensitive file, so content access remains opt-in.

## Composer commands

### /auto-review

With no arguments, `/auto-review` toggles the feature. `on` and `off` set the state; `status` prints the effective configuration, including what an external reviewer receives.

### /approve

`/approve` lists the ten most recent denials in the current session. `/approve N` displays one record's tool, directory, complete arguments, risk, reason, and fingerprint. Displaying the record does not authorize anything.

After `/approve N` has been displayed, `/approve N confirm` permits one retry of that exact action. The approval is sent to the reviewer as trusted evidence, and the retry still requires a reviewer verdict. `critical` actions remain denied. Records are kept in memory, up to ten per session, and are cleared when the current profile process exits.

Settings changes apply live. Loading new plugin code requires restarting the running profile.
