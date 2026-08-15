export interface RequiredBehavior {
  id: string
  check: string
  requirement: string
}

/** Behavior checks that CI requires in addition to code-coverage thresholds. */
export const REQUIRED_BEHAVIORS: RequiredBehavior[] = [
  // approval/request and allowRules
  { id: 'approval.prepend-answerer', check: 'handler registered with prepend', requirement: 'The auto-review answerer is registered before the interactive approval answerer.' },
  { id: 'approval.session-model-allow', check: 'session-model grants', requirement: 'The session-model reviewer can return allowed-once.' },
  { id: 'approval.allow-rules', check: 'typed allow grants once', requirement: 'A matching allowRules entry returns allowed-once without reviewer execution.' },
  { id: 'approval.allow-rule-prefix', check: 'prefix rule matches subcommand', requirement: 'allowRules use literal operation-prefix matching.' },
  { id: 'approval.allow-rule-escalation-target', check: 'typed rule grants declared escalation target', requirement: 'An escalation allowRule grants only its declared workspace-write target.' },
  { id: 'approval.no-danger-full-access-allow-rule', check: 'danger-full-access never granted by allow rule', requirement: 'allowRules cannot grant danger-full-access.' },
  { id: 'approval.tool-filter', check: 'tool filter delegates excluded approval asks', requirement: 'Approval requests outside policy.tools delegate to the next answerer.' },
  { id: 'approval.pre-abort', check: 'already-aborted approval returns cancelled', requirement: 'An already aborted approval request returns cancelled.' },
  { id: 'approval.max-input', check: 'maxInputChars rejects oversized pending request without reviewer', requirement: 'A pending request larger than maxInputChars is rejected without truncation or reviewer execution.' },
  { id: 'approval.authorization-overflow', check: 'authorization overflow fails closed', requirement: 'A latest user message larger than the context budget is rejected without truncation.' },
  { id: 'approval.missing-tool-call', check: 'missing tool call fails closed', requirement: 'A callId that cannot be resolved to its tool/call event is rejected.' },
  { id: 'approval.no-call-id', check: 'callId-less ask delegates to human', requirement: 'An approval request without callId delegates to the next answerer.' },
  { id: 'approval.post-denial-confirm', check: 'confirmed retry allows', requirement: '/approve reveal + confirm supplies trusted authorization for one retry.' },
  { id: 'approval.post-denial-one-use', check: 'override consumed after one use', requirement: 'A post-denial approval is consumed after one exact-action retry.' },

  // reviewer and evidence
  { id: 'reviewer.critical-normalization', check: 'critical risk normalized to deny', requirement: 'A critical-risk reviewer verdict cannot allow the request.' },
  { id: 'reviewer.final-answer-only', check: 'chain-of-thought never parses as verdict', requirement: 'Reviewer reasoning content is not parsed as the authorization verdict.' },
  { id: 'reviewer.thinking-endpoint-off', check: 'wire sends thinking disabled', requirement: 'thinking=off sends DeepSeek thinking disabled on the explicit endpoint path.' },
  { id: 'reviewer.thinking-session-deepseek-off', check: 'session-model thinking-off maps to adapter effort off', requirement: 'thinking=off maps to reasoningEffort=off for the deepseek-official session provider.' },
  { id: 'reviewer.thinking-session-other-provider', check: 'non-deepseek provider: no effort override', requirement: 'thinking=off does not add a reasoning override for other session providers.' },
  { id: 'reviewer.api-key-direct-precedence', check: 'resolveApiKey uses apiKey before apiKeyEnv and apiKeyFile', requirement: 'Reviewer API keys resolve apiKey before apiKeyEnv and apiKeyFile.' },
  { id: 'reviewer.api-key-env-precedence', check: 'resolveApiKey uses apiKeyEnv before apiKeyFile', requirement: 'Reviewer API keys resolve apiKeyEnv before apiKeyFile when apiKey is absent.' },
  { id: 'evidence.no-reasoning', check: 'evidence excludes reasoning', requirement: 'Agent reasoning is excluded from reviewer evidence.' },
  { id: 'evidence.no-raw-tool-result-default', check: 'evidence excludes raw tool-result text', requirement: 'Raw tool-result text is excluded unless rawToolResults is enabled.' },
  { id: 'evidence.raw-tool-result-opt-in', check: 'rawToolResults true includes raw text', requirement: 'rawToolResults=true includes raw tool-result text in reviewer evidence.' },
  { id: 'reviewer.reasoning-only', check: 'reasoning-only output fails closed as unavailable', requirement: 'With denyOnReviewerError=true, a response without final text returns unavailable.' },
  { id: 'reviewer.malformed-retry', check: 'malformed verdict retried then allowed', requirement: 'One malformed reviewer reply gets one retry.' },
  { id: 'reviewer.double-malformed-default', check: 'double-malformed fails closed', requirement: 'With denyOnReviewerError=true, a second malformed reviewer reply returns unavailable.' },
  { id: 'reviewer.double-malformed-delegate', check: 'double-malformed delegates when reviewer errors are delegated', requirement: 'A second malformed reviewer reply delegates when denyOnReviewerError=false.' },
  { id: 'reviewer.unavailable-default', check: 'reviewer-error fails closed as unavailable', requirement: 'Reviewer failure returns unavailable when denyOnReviewerError=true.' },
  { id: 'reviewer.unavailable-delegate', check: 'reviewer-error delegates when configured', requirement: 'Reviewer failure delegates when denyOnReviewerError=false.' },
  { id: 'reviewer.endpoint-no-key', check: 'endpoint reviewer without key fails before fetch', requirement: 'An explicit reviewer endpoint without an API key fails before fetch.' },
  { id: 'reviewer.endpoint-http-error', check: 'endpoint reviewer exposes bounded HTTP failure', requirement: 'Reviewer HTTP error text is limited before denyOnReviewerError is applied.' },
  { id: 'reviewer.session-no-llm', check: 'session reviewer without llm service fails closed', requirement: 'Session-model review requires the Harness llm service.' },
  { id: 'reviewer.session-no-provider-model', check: 'session reviewer without provider-model fails closed', requirement: 'Session-model review requires the calling agent provider and model.' },
  { id: 'reviewer.mid-review-abort', check: 'abort during reviewer failure returns cancelled', requirement: 'Cancellation during reviewer execution returns cancelled.' },

  // fact finding
  { id: 'fact-finding.loop', check: 'fact loop reaches verdict', requirement: 'A fact request can return observations and continue to a final verdict.' },
  { id: 'fact-finding.max-facts', check: 'fact query batch is clipped to remaining budget', requirement: 'maxFacts limits each fact request before fact execution.' },
  { id: 'fact-finding.limit-default', check: 'fact limit fails closed', requirement: 'With denyOnReviewerError=true, exceeding fact-finding limits returns unavailable.' },
  { id: 'fact-finding.disabled-default', check: 'fact request with fact finding disabled returns unavailable by default', requirement: 'With denyOnReviewerError=true, a fact request returns unavailable when factFinding.enabled=false.' },
  { id: 'fact-finding.error-delegate', check: 'fact-finding error delegates when reviewer errors are delegated', requirement: 'Fact-finding errors delegate when denyOnReviewerError=false.' },
  { id: 'fact-finding.content-opt-in', check: 'content request while disabled fails closed', requirement: 'inspect_text_file requires factFinding.content.enabled.' },
  { id: 'fact-finding.content-external-endpoint', check: 'external endpoint receives content observation', requirement: 'An explicit reviewer endpoint can receive requested file content when content inspection is enabled.' },
  { id: 'fact-finding.content-session-model', check: 'session-model content inspection allowed', requirement: 'The session-model reviewer can receive requested file content when content inspection is enabled.' },
  { id: 'fact-finding.content-sensitive-path', check: 'sensitive path denied', requirement: 'inspect_text_file refuses known sensitive paths.' },
  { id: 'fact-finding.content-binary', check: 'binary denied', requirement: 'inspect_text_file refuses binary files.' },
  { id: 'fact-finding.content-max-bytes', check: 'oversized denied', requirement: 'inspect_text_file refuses files larger than factFinding.content.maxBytes.' },
  { id: 'fact-finding.workspace-boundary', check: 'outside workspace denied', requirement: 'Fact tools refuse paths outside the workspace without exposing outside metadata.' },
  { id: 'fact-finding.git-credential-redaction', check: 'git url credentials stripped', requirement: 'inspect_git_remote removes credentials from remote URLs.' },
  { id: 'fact-finding.git-fsmonitor', check: 'git status runs with fsmonitor off', requirement: 'The git fact probe disables fsmonitor.' },
  { id: 'fact-finding.git-hooks', check: 'git status runs with clean hooksPath', requirement: 'The git fact probe uses an empty hooksPath.' },
  { id: 'fact-finding.sandbox-policy-failure', check: 'sandbox policy failure falls back to session cwd', requirement: 'Failure to read sandboxPolicy metadata falls back to the session cwd.' },

  // circuit breaker
  { id: 'breaker.trip', check: 'circuit breaker cancels turn', requirement: 'The configured consecutive denial limit trips the circuit breaker.' },
  { id: 'breaker.window-limit', check: 'breaker window counts approval outcomes', requirement: 'The breaker window counts approval outcomes in the current turn, not reviewer calls.' },
  { id: 'breaker.turn-reset', check: 'breaker resets across turns', requirement: 'Breaker state resets on a new turn.' },
  { id: 'breaker.reviewer-unavailable-neutral', check: 'infra errors never trip breaker', requirement: 'Reviewer unavailability does not count as a denial.' },
  { id: 'breaker.non-denial-reset', check: 'unavailable breaks the streak: 2 consecutive after reset does not trip', requirement: 'A non-denial resets the consecutive-denial count.' },
  { id: 'breaker.action-off', check: 'breaker off performs no trip action', requirement: 'breaker.action=off does not inject or cancel when the breaker trips.' },
  { id: 'breaker.action-inject', check: 'breaker inject action explains without cancelling', requirement: 'breaker.action=inject injects the breaker notice without cancelling the agent turn.' },
  { id: 'breaker.agent-callback-failure', check: 'breaker callback failures never escape answerer', requirement: 'Failures from agent.inject or agent.cancel do not escape the approval answerer.' },

  // audit
  { id: 'audit.hash-default', check: 'audit defaults to hash-only decision record', requirement: 'Audit records store inputSha256 and omit raw tool input by default.' },
  { id: 'audit.raw-input-opt-in', check: 'audit raw tool input requires explicit opt-in', requirement: 'Raw tool input is written only when includeToolInput is enabled.' },
  { id: 'audit.write-failure', check: 'audit write failure is contained and logged', requirement: 'Audit write failure is logged and not thrown by Auditor.record().' },

  // configuration and commands
  { id: 'configuration.default-enabled', check: 'Config defaults enabled', requirement: 'The plugin is enabled by default.' },
  { id: 'configuration.invalid-allow-rule', check: 'empty allow-rule tool is rejected', requirement: 'An allowRules entry requires a non-empty tool name.' },
  { id: 'configuration.invalid-row-config', check: 'structurally invalid row config refuses to arm', requirement: 'An invalid row config does not arm auto-review.' },
  { id: 'configuration.live-update', check: 'live config: valid allow rule grants', requirement: 'A valid settings update changes subsequent approval behavior without restarting the profile.' },
  { id: 'configuration.invalid-live-update', check: 'invalid live update retains last known-good', requirement: 'An invalid settings update keeps the last valid config.' },
  { id: 'configuration.settings-registration', check: 'settings registration failure uses valid row config', requirement: 'If settings registration fails, a valid row config is used.' },
  { id: 'configuration.settings-read-before-good', check: 'settings read failure before valid config delegates', requirement: 'A settings read failure before any valid config delegates to the next answerer.' },
  { id: 'configuration.settings-read-after-good', check: 'settings read failure keeps last valid config', requirement: 'A settings read failure after a valid config keeps the last valid config.' },
  { id: 'commands.toggle', check: 'command bare toggles to false', requirement: '/auto-review with no argument toggles the enabled setting.' },
  { id: 'commands.status', check: 'command status succeeds', requirement: '/auto-review status reports the effective configuration.' },
  { id: 'commands.no-settings-provider', check: 'auto-review toggle without settings provider errors', requirement: '/auto-review does not report a persisted toggle when the settings service is unavailable.' },
  { id: 'commands.persistence-failure', check: 'auto-review persistence failure is surfaced', requirement: '/auto-review reports settings update failures.' },
  { id: 'commands.approve-list', check: 'approve lists denial', requirement: '/approve lists recent denials in the current session.' },
  { id: 'commands.approve-reveal-required', check: 'confirm without reveal rejected', requirement: '/approve N confirm requires the denial record to be displayed first.' },
  { id: 'commands.approve-reveal-no-grant', check: 'reveal grants nothing', requirement: '/approve N displays the denial record without authorizing a retry.' },
  { id: 'commands.approve-session-cap', check: 'flooder ledger capped at 10 per session', requirement: 'The denial ledger retains at most ten records per session.' },
]
