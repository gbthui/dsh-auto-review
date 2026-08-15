export type BehaviorClass = 'core' | 'safety' | 'fallback' | 'recovery'

export interface RequiredBehavior {
  id: string
  class: BehaviorClass
  check: string
  why: string
}

/**
 * Contract-level behaviors that CI must observe as executed and passing.
 *
 * This is deliberately separate from numeric code coverage. A refactor may
 * keep line/branch percentages high while deleting a product-defining or
 * fail-safe scenario entirely. The test runner records successful `check()`
 * labels and fails if any contract item below disappears.
 */
export const REQUIRED_BEHAVIORS: RequiredBehavior[] = [
  { id: 'core.prepend-answerer', class: 'core', check: 'handler registered with prepend', why: 'auto-review must answer approval requests before ordinary interactive approval' },
  { id: 'core.session-reviewer-allow', class: 'core', check: 'session-model grants', why: 'the default session-model reviewer can approve an eligible action' },
  { id: 'core.typed-direct-allow', class: 'core', check: 'typed allow grants once', why: 'an exact typed allow rule grants one request without reviewer latency' },
  { id: 'core.fact-loop', class: 'core', check: 'fact loop reaches verdict', why: 'the reviewer can request bounded local facts and then reach a verdict' },
  { id: 'core.post-denial-approval', class: 'core', check: 'confirmed retry allows', why: 'the two-step /approve reveal + confirm path reaches a one-retry authorization' },
  { id: 'core.audit-decision', class: 'core', check: 'audit defaults to hash-only decision record', why: 'every audited decision records its input identity while keeping raw tool input private by default' },

  { id: 'safety.no-danger-full-access-direct-rule', class: 'safety', check: 'danger-full-access never granted by allow rule', why: 'direct rules must never mint danger-full-access' },
  { id: 'safety.authorization-overflow', class: 'safety', check: 'authorization overflow fails closed', why: 'trusted user authorization is never silently truncated' },
  { id: 'safety.critical-normalization', class: 'safety', check: 'critical risk normalized to deny', why: 'a reviewer cannot allow a critical-risk action' },
  { id: 'safety.no-chain-of-thought-verdict', class: 'safety', check: 'chain-of-thought never parses as verdict', why: 'reasoning content is not accepted as the final authorization decision' },
  { id: 'safety.no-reasoning-egress', class: 'safety', check: 'evidence excludes reasoning', why: 'agent chain-of-thought is excluded from reviewer evidence' },
  { id: 'safety.no-raw-tool-result-egress', class: 'safety', check: 'evidence excludes raw tool-result text', why: 'raw tool output is omitted by default because it is an untrusted prompt-injection surface' },
  { id: 'safety.content-egress-opt-in', class: 'safety', check: 'content request while disabled fails closed', why: 'workspace file content cannot leave the process without explicit opt-in' },
  { id: 'safety.audit-raw-input-opt-in', class: 'safety', check: 'audit raw tool input requires explicit opt-in', why: 'raw tool arguments enter the audit file only after explicit configuration' },

  { id: 'fallback.reviewer-down-default', class: 'fallback', check: 'reviewer-error fails closed as unavailable', why: 'reviewer infrastructure failure does not accidentally authorize an action' },
  { id: 'fallback.reviewer-down-configured-delegate', class: 'fallback', check: 'reviewer-error delegates when configured', why: 'operators can explicitly fall back to interactive approval' },
  { id: 'fallback.missing-tool-call', class: 'fallback', check: 'missing tool call fails closed', why: 'an approval cannot be granted when the exact call cannot be resolved' },
  { id: 'fallback.callid-less-human', class: 'fallback', check: 'callId-less ask delegates to human', why: 'non-correlatable approval requests remain interactive instead of being guessed' },
  { id: 'fallback.reasoning-only-review', class: 'fallback', check: 'reasoning-only output fails closed as unavailable', why: 'a reviewer response without final text cannot authorize' },
  { id: 'fallback.double-malformed', class: 'fallback', check: 'double-malformed fails closed', why: 'one formatting retry is bounded and a second parse failure closes the path' },
  { id: 'fallback.fact-budget', class: 'fallback', check: 'fact limit fails closed', why: 'fact finding cannot loop indefinitely or grow without bound' },
  { id: 'fallback.fact-content-disabled', class: 'fallback', check: 'content-disabled audit source', why: 'denied content fact requests are auditable as fact-limit failures' },

  { id: 'recovery.malformed-retry', class: 'recovery', check: 'malformed verdict retried then allowed', why: 'a single malformed reviewer reply gets exactly one corrective retry' },
  { id: 'recovery.breaker-trip', class: 'recovery', check: 'circuit breaker cancels turn', why: 'repeated denials stop agent circumvention loops' },
  { id: 'recovery.breaker-turn-reset', class: 'recovery', check: 'breaker resets across turns', why: 'denial state is scoped to the current turn' },
  { id: 'recovery.infra-neutral-breaker', class: 'recovery', check: 'infra errors never trip breaker', why: 'reviewer outages are not misclassified as policy denials' },
  { id: 'recovery.non-denial-reset', class: 'recovery', check: 'unavailable breaks the streak: 2 consecutive after reset does not trip', why: 'any non-denial resets the consecutive-denial counter' },
  { id: 'recovery.override-one-use', class: 'recovery', check: 'override consumed after one use', why: 'post-denial user approval is exact-action and one-use only' },
  { id: 'recovery.last-known-good-config', class: 'recovery', check: 'invalid live update retains last known-good', why: 'a malformed live config cannot disarm the previously valid policy' },
]
