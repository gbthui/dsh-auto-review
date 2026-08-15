export interface RequiredBehavior {
  id: string
  check: string
  requirement: string
}

/**
 * Behaviors that must be observed as executed and passing in CI.
 *
 * Code coverage and this contract guard different failures. Coverage catches
 * untested control flow. This list keeps the approval, reviewer, fact-finding,
 * breaker, audit, configuration, and command behaviors below from disappearing
 * while aggregate coverage remains above its threshold.
 */
export const REQUIRED_BEHAVIORS: RequiredBehavior[] = [
  // approval/request
  { id: 'approval.prepend-answerer', check: 'handler registered with prepend', requirement: 'The auto-review answerer is registered before the interactive approval answerer.' },
  { id: 'approval.session-model-allow', check: 'session-model grants', requirement: 'The session-model reviewer can return allowed-once.' },
  { id: 'approval.allow-rules', check: 'typed allow grants once', requirement: 'A matching allowRules entry returns allowed-once without reviewer execution.' },
  { id: 'approval.no-danger-full-access-allow-rule', check: 'danger-full-access never granted by allow rule', requirement: 'allowRules cannot grant danger-full-access.' },
  { id: 'approval.tool-filter', check: 'tool filter delegates excluded approval asks', requirement: 'Approval requests outside policy.tools delegate to the next answerer.' },
  { id: 'approval.pre-abort', check: 'already-aborted approval returns cancelled', requirement: 'An already aborted approval request returns cancelled.' },
  { id: 'approval.authorization-overflow', check: 'authorization overflow fails closed', requirement: 'An over-budget latest user authorization fails closed without truncation.' },
  { id: 'approval.missing-tool-call', check: 'missing tool call fails closed', requirement: 'A callId that cannot be resolved to its tool/call event fails closed.' },
  { id: 'approval.no-call-id', check: 'callId-less ask delegates to human', requirement: 'An approval request without callId delegates to the next answerer.' },
  { id: 'approval.post-denial-confirm', check: 'confirmed retry allows', requirement: '/approve reveal + confirm supplies one trusted retry authorization to the reviewer.' },
  { id: 'approval.post-denial-one-use', check: 'override consumed after one use', requirement: 'A post-denial approval is consumed after one exact-action retry.' },

  // reviewer and evidence
  { id: 'reviewer.critical-normalization', check: 'critical risk normalized to deny', requirement: 'A critical-risk reviewer verdict cannot allow the request.' },
  { id: 'reviewer.final-answer-only', check: 'chain-of-thought never parses as verdict', requirement: 'Reviewer reasoning content is not parsed as the authorization verdict.' },
  { id: 'evidence.no-reasoning', check: 'evidence excludes reasoning', requirement: 'Agent reasoning is excluded from reviewer evidence.' },
  { id: 'evidence.no-raw-tool-result-default', check: 'evidence excludes raw tool-result text', requirement: 'Raw tool-result text is excluded unless rawToolResults is enabled.' },
  { id: 'reviewer.reasoning-only', check: 'reasoning-only output fails closed as unavailable', requirement: 'A reviewer response without final text cannot authorize an action.' },
  { id: 'reviewer.malformed-retry', check: 'malformed verdict retried then allowed', requirement: 'One malformed reviewer reply gets one corrective retry.' },
  { id: 'reviewer.double-malformed', check: 'double-malformed fails closed', requirement: 'A second malformed reviewer reply fails closed.' },
  { id: 'reviewer.unavailable-default', check: 'reviewer-error fails closed as unavailable', requirement: 'Reviewer failure returns unavailable when denyOnReviewerError is enabled.' },
  { id: 'reviewer.unavailable-delegate', check: 'reviewer-error delegates when configured', requirement: 'Reviewer failure delegates when denyOnReviewerError is disabled.' },
  { id: 'reviewer.endpoint-no-key', check: 'endpoint reviewer without key fails before fetch', requirement: 'An explicit reviewer endpoint without an API key fails before fetch.' },
  { id: 'reviewer.endpoint-http-error', check: 'endpoint reviewer exposes bounded HTTP failure', requirement: 'Reviewer HTTP errors are bounded before entering the fail-closed path.' },
  { id: 'reviewer.session-no-llm', check: 'session reviewer without llm service fails closed', requirement: 'Session-model review requires the Harness llm service.' },
  { id: 'reviewer.session-no-provider-model', check: 'session reviewer without provider-model fails closed', requirement: 'Session-model review requires the calling agent provider and model.' },
  { id: 'reviewer.mid-review-abort', check: 'abort during reviewer failure returns cancelled', requirement: 'Cancellation during reviewer execution returns cancelled.' },

  // fact finding
  { id: 'fact-finding.loop', check: 'fact loop reaches verdict', requirement: 'A bounded fact request can return observations and continue to a final verdict.' },
  { id: 'fact-finding.max-facts', check: 'fact query batch is clipped to remaining budget', requirement: 'maxFacts limits each fact request before fact execution.' },
  { id: 'fact-finding.limit', check: 'fact limit fails closed', requirement: 'Exceeding the fact-finding limits fails closed.' },
  { id: 'fact-finding.disabled', check: 'fact request with fact finding disabled fails closed', requirement: 'A reviewer fact request fails closed when factFinding.enabled is false.' },
  { id: 'fact-finding.content-opt-in', check: 'content request while disabled fails closed', requirement: 'inspect_text_file requires factFinding.content.enabled.' },
  { id: 'fact-finding.sandbox-policy-failure', check: 'sandbox policy failure falls back to session cwd', requirement: 'Failure to read sandboxPolicy metadata falls back to the session cwd.' },

  // circuit breaker
  { id: 'breaker.trip', check: 'circuit breaker cancels turn', requirement: 'The configured denial limit trips the circuit breaker.' },
  { id: 'breaker.turn-reset', check: 'breaker resets across turns', requirement: 'Breaker denial state resets on a new turn.' },
  { id: 'breaker.reviewer-unavailable-neutral', check: 'infra errors never trip breaker', requirement: 'Reviewer unavailability does not count as a policy denial.' },
  { id: 'breaker.non-denial-reset', check: 'unavailable breaks the streak: 2 consecutive after reset does not trip', requirement: 'A non-denial resets the consecutive-denial count.' },
  { id: 'breaker.action-off', check: 'breaker off performs no trip action', requirement: 'breaker.action=off does not inject or cancel when the breaker trips.' },
  { id: 'breaker.action-inject', check: 'breaker inject action explains without cancelling', requirement: 'breaker.action=inject injects the breaker notice without cancelling the agent turn.' },
  { id: 'breaker.agent-callback-failure', check: 'breaker callback failures never escape answerer', requirement: 'Failures from agent.inject or agent.cancel do not escape the approval answerer.' },

  // audit
  { id: 'audit.hash-default', check: 'audit defaults to hash-only decision record', requirement: 'Audit records store inputSha256 and omit raw tool input by default.' },
  { id: 'audit.raw-input-opt-in', check: 'audit raw tool input requires explicit opt-in', requirement: 'Raw tool input is written only when includeToolInput is enabled.' },
  { id: 'audit.write-failure', check: 'audit write failure is contained and logged', requirement: 'Audit I/O failure is logged and does not escape Auditor.record().' },

  // configuration and commands
  { id: 'configuration.invalid-allow-rule', check: 'empty allow-rule tool is rejected', requirement: 'An allowRules entry requires a non-empty tool name.' },
  { id: 'configuration.invalid-row-config', check: 'structurally invalid row config refuses to arm', requirement: 'A structurally invalid row config does not arm auto-review.' },
  { id: 'configuration.invalid-live-update', check: 'invalid live update retains last known-good', requirement: 'An invalid live settings update keeps the last known-good config.' },
  { id: 'configuration.settings-registration', check: 'settings registration failure falls back to valid row config', requirement: 'A settings registration failure uses the valid row config.' },
  { id: 'configuration.settings-read-before-good', check: 'settings read failure before any good config delegates safely', requirement: 'A settings read failure before any valid config delegates approval to the next answerer.' },
  { id: 'configuration.settings-read-after-good', check: 'settings read failure retains last known-good config', requirement: 'A transient settings read failure keeps the last known-good config.' },
  { id: 'commands.no-settings-provider', check: 'auto-review toggle without settings provider errors', requirement: '/auto-review does not report a persisted toggle when the settings service is unavailable.' },
  { id: 'commands.persistence-failure', check: 'auto-review persistence failure is surfaced', requirement: '/auto-review reports settings update failures.' },
]
