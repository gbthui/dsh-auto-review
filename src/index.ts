/**
 * dsh-auto-review — reviewer-substitution answerer for DeepSeek Harness.
 *
 * What it does (Codex auto-review semantics mapped onto the DSH approval seam):
 *   - Registers a PREPENDED answerer on the `approval/request` waterfall, so
 *     approval asks (primarily sandbox-escalation retries) are decided by a
 *     reviewer model before the interactive GUI answerer ever sees them.
 *   - Fail-closed integrity checks first: an input truncation guard (never
 *     hand a truncated input to the reviewer) and a tool-call resolution
 *     guard (never allow arguments the reviewer cannot see). The reviewer
 *     makes every risk judgment; code does not try to parse shell commands.
 *   - On reviewer failure it fails closed (configurable to delegate to the
 *     human answerer instead).
 *   - Denials inject an anti-circumvention notice into the model-facing
 *     context, and a circuit breaker (3 consecutive denials, or 10 denials in
 *     the last 50 approval outcomes) cancels the agent turn to stop denial loops.
 *   - Every decision appends one JSON line to an audit file; tool input is
 *     stored as a sha256 hash unless `includeToolInput` is enabled.
 *   - The verdict must come from the model's FINAL answer; chain-of-thought
 *     output is never parsed as an authorization.
 *
 * Module map (security boundary code, split for auditability):
 *   meta / config / policy  — identity, schema, reviewer policy
 *   evidence                — trusted vs untrusted evidence, authorization
 *                             completeness (never truncate an authorization)
 *   facts                   — bounded read-only fact tools (hardened git)
 *   reviewer                — endpoint + session-model review, verdict parsing
 *   approval-answerer       — the decision pipeline + /approve denial ledger
 *   breaker                 — per-turn denial circuit breaker
 *   audit                   — JSONL audit sink
 *
 * @module dsh-auto-review
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { name, NS } from './meta.ts'
import type { LoggerLike, PluginContext } from './util.ts'
import type { ResolvedConfig } from './config.ts'
import { Config } from './config.ts'
import { validateConfig } from './policy.ts'
import { Breaker } from './breaker.ts'
import { createAuditor } from './audit.ts'
import { createAnswerer, DenialLedger } from './approval-answerer.ts'

export { name, NS, inject } from './meta.ts'
export { Config, type ResolvedConfig } from './config.ts'
export { DEFAULT_REVIEWER_POLICY, validateConfig } from './policy.ts'
export { sha256, expandHome, type LoggerLike, type PluginContext } from './util.ts'
export {
  buildEvidence,
  findToolCall,
  serializeRequest,
  actionFingerprint,
  PRIOR_MESSAGE_MAX_CHARS,
  type UserEvidenceEntry,
  type Evidence,
  type EvidenceBudget,
  type PostDenialApproval,
  type ToolCallRecord,
} from './evidence.ts'
export {
  executeFacts,
  sanitizeGitUrl,
  isSensitiveContentPath,
  CONTENT_DENY_PATH_PATTERNS,
  FACT_TOOLS,
  type FactQuery,
  type FactObservation,
  type FactExecutionOptions,
} from './facts.ts'
export {
  parseVerdict,
  parseReviewerReply,
  buildPrompt,
  callReviewer,
  reviewWithSessionModel,
  resolveApiKey,
  type Verdict,
  type ReviewerReply,
  type ReviewerPrompt,
  type ReviewerEndpointConfig,
  type SessionModelLlmRuntime,
  type SessionModelReviewerCtx,
} from './reviewer.ts'
export { Breaker, currentTurn } from './breaker.ts'
export { createAuditor, type Auditor, type AuditEntry } from './audit.ts'
export { createAnswerer, reviewOnceWithParseRetry, matchAllowRule, DenialLedger, type AllowRule, type Answerer, type AnswererDeps, type DenialRecord } from './approval-answerer.ts'

interface SettingsScopeLike {
  get(): ResolvedConfig
  update(patch: { enabled?: boolean }): Promise<void>
}

interface SettingsProviderLike {
  register(namespace: string, schema: unknown, options: { base?: unknown; applies?: string }): SettingsScopeLike
}

/**
 * The plugin: a prepended `approval/request` answerer. Wires the settings
 * scope, the breaker/audit/ledger instances, and the composer commands.
 */
export function apply(ctx: Context | PluginContext, config?: unknown): void {
  const rowConfig = (config ?? {}) as Record<string, unknown>
  const log = (ctx as { logger: (name: string) => LoggerLike }).logger(name)
  let scope: SettingsScopeLike | null = null
  let fallback: ResolvedConfig | null = null
  let registerTried = false

  const getService = (serviceName: string): unknown => {
    try {
      return (ctx as unknown as { get?: (n: string) => unknown }).get?.(serviceName)
    } catch {
      return undefined
    }
  }

  const ensureConfig = (): void => {
    if (registerTried) return
    registerTried = true
    const settings = getService('settings') as SettingsProviderLike | undefined
    if (settings) {
      try {
        scope = settings.register(NS, Config, { base: rowConfig, applies: 'live' })
        return
      } catch (error) {
        log.warn('settings registration failed; falling back to row config: %s', String((error as Error)?.message ?? error))
      }
    }
    armRowConfig()
  }

  /**
   * Security-sensitive config resolution. An invalid config is never
   * skipped, defaulted, or partially applied: the plugin REFUSES to arm
   * (boot-time row config) or REFUSES the update (live settings) and retains
   * the last known-good config. When nothing valid was ever armed, the
   * effective config is disabled — approval asks delegate to the human
   * answerer instead of running a silently shrunken policy.
   */
  const refuseConfig = Config({ enabled: false }) as unknown as ResolvedConfig
  let lastGood: ResolvedConfig | null = null
  let lastRefusal: string | null = null

  const armRowConfig = (): void => {
    let candidate: ResolvedConfig
    try {
      candidate = Config(rowConfig) as unknown as ResolvedConfig
    } catch (error) {
      log.error('refusing to arm: invalid row config: %s', String((error as Error)?.message ?? error))
      return
    }
    const invalid = validateConfig(candidate)
    if (invalid) {
      log.error('refusing to arm: %s', invalid)
      return
    }
    fallback = candidate
  }

  const cfg = (): ResolvedConfig => {
    ensureConfig()
    if (!scope) return fallback ?? refuseConfig
    let candidate: ResolvedConfig
    try {
      candidate = scope.get()
    } catch (error) {
      if (lastRefusal !== 'settings-read') {
        log.warn('settings read failed; retaining last known-good config: %s', String((error as Error)?.message ?? error))
        lastRefusal = 'settings-read'
      }
      return lastGood ?? refuseConfig
    }
    const invalid = validateConfig(candidate)
    if (invalid) {
      if (lastRefusal !== invalid) {
        log.error('refusing to apply config update: %s (retaining last known-good config)', invalid)
        lastRefusal = invalid
      }
      return lastGood ?? refuseConfig
    }
    lastRefusal = null
    lastGood = candidate
    return candidate
  }

  const breaker = new Breaker()
  const auditor = createAuditor({ cfg, log })
  const ledger = new DenialLedger()
  const handler = createAnswerer({ ctx, getService, cfg, log, breaker, auditor, ledger })

  ;(ctx as PluginContext).on('approval/request', handler as unknown, true)


  // Composer commands: /auto-review and /approve. The plugin declares
  // inject ['commands'], so the registry is provided before apply; the
  // guard below keeps apply safe in compositions without the registry.
  // /approve is two-step: N reveals the EXACT denied action; N confirm
  // (only after the reveal) grants one retry — the trusted-evidence
  // semantics require that the user actually saw the full action first.
  const pendingReveals = new Map<string, number>()
  try {
    const commands = getService('commands') as { register?: (definition: CommandDefinition) => void } | undefined
    if (commands && typeof commands.register === 'function') {
      const definition: CommandDefinition = {
        name: 'auto-review',
        description: 'Toggle or inspect the auto-review guardian (bare toggles; on / off / status)',
        input: { hint: '[on|off|status]' },
        handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
          ensureConfig()
          const arg = String(invocation.rawInput ?? '').trim().toLowerCase()
          if (arg === 'on' || arg === 'off' || arg === '') {
            // Bare execution toggles the current state.
            const enabled = arg === '' ? !cfg().enabled : arg === 'on'
            if (!scope) {
              return { kind: 'error', text: 'no settings provider mounted; edit dsh-auto-review.enabled in settings.yaml instead' }
            }
            try {
              await scope.update({ enabled })
              return {
                kind: 'success',
                text: enabled
                  ? 'auto-review enabled: approval asks are decided by the reviewer before any interactive prompt.'
                  : 'auto-review disabled: approval asks fall through to the interactive answerer (human approval).',
              }
            } catch (error) {
              return { kind: 'error', text: 'failed to persist: ' + String((error as Error)?.message ?? error) }
            }
          }
          if (arg === 'status') {
            const c = cfg()
            return {
              kind: 'success',
              text: [
                'auto-review ' + (c.enabled ? 'enabled' : 'disabled'),
                'reviewer ' + (c.reviewer.baseURL
                  ? c.reviewer.model + ' @ ' + c.reviewer.baseURL + ' — EGRESS: user requests, tool arguments, execution context, workspace/sandbox facts' + (c.reviewer.factFinding.enabled && c.reviewer.factFinding.content.enabled ? ', and requested workspace file content' : '; file content inspection is off')
                  : 'session model (calling agent provider/model) — local trust domain, no egress'),
                'denyOnReviewerError ' + c.policy.denyOnReviewerError,
                'breaker ' + c.breaker.action + ' (' + c.breaker.consecutiveDenyLimit + ' consecutive, ' + c.breaker.windowDenyLimit + ' per ' + c.breaker.windowSize + ')',
                'context ' + (c.policy.context.enabled ? 'on' : 'off'),
                'thinking ' + c.reviewer.thinking,
                'audit ' + (c.audit.enabled ? 'on' : 'off') + ' @ ' + c.audit.path,
              ].join('; '),
            }
          }
          return { kind: 'error', text: 'usage: /auto-review on | off | status (bare toggles)' }
        },
      }
      commands.register(definition)

      const approveDefinition: CommandDefinition = {
        name: 'approve',
        description: 'Re-authorize one recently denied action (one retry, still reviewed)',
        input: { hint: '[N]' },
        handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
          const sid = invocation.agent?.session?.id ?? invocation.agent?.id ?? ''
          const mine = ledger.list(sid)
          if (mine.length === 0) {
            return { kind: 'error', text: 'no recent auto-review denials for this session' }
          }
          const arg = String(invocation.rawInput ?? '').trim()
          if (arg === '') {
            return {
              kind: 'success',
              text: mine.map((d, i) => (i + 1) + '. ' + d.toolName + ' ' + d.arguments.slice(0, 80) + ' [' + d.risk + '] ' + d.reason.slice(0, 60)).join('\n') +
                '\n\n/approve N shows the EXACT denied action (full arguments, cwd, identity hash); /approve N confirm authorizes one retry of it.',
            }
          }
          const match = /^(\d+)(?:\s+confirm)?$/.exec(arg)
          const n = match ? Number(match[1]) : NaN
          const picked = Number.isInteger(n) && n >= 1 && n <= mine.length ? mine[n - 1] : null
          if (!picked) {
            return { kind: 'error', text: 'pick a number between 1 and ' + mine.length + ' (optionally "N confirm"), or run /approve to list' }
          }
          const wantsConfirm = /\s+confirm$/.test(arg)
          if (!wantsConfirm) {
            // Reveal ONLY. The security model defines post-denial approval
            // as "the user saw the EXACT action", so the full canonical
            // action is shown and the confirm step acknowledges it — a
            // 80-char summary is not exact-action sight.
            pendingReveals.set(sid, picked.id)
            return {
              kind: 'success',
              text: [
                'Denied action #' + picked.id + ' (the EXACT action, in full):',
                'tool:      ' + picked.toolName,
                'cwd:       ' + picked.cwd,
                'arguments: ' + picked.arguments,
                'risk:      ' + picked.risk,
                'reason:    ' + picked.reason,
                'identity:  ' + picked.fingerprint + ' (sha256 of tool + canonical arguments + cwd)',
                'denied at: ' + new Date(picked.timestamp).toISOString(),
                '',
                'Nothing is authorized yet. To authorize ONE retry of exactly this action, run /approve ' + n + ' confirm.',
                'The retry is still reviewed with this approval as trusted evidence; critical-risk actions still deny.',
              ].join('\n'),
            }
          }
          if (pendingReveals.get(sid) !== picked.id) {
            return { kind: 'error', text: 'run /approve ' + n + ' first to see the exact action, then /approve ' + n + ' confirm' }
          }
          pendingReveals.delete(sid)
          ledger.grant(sid, picked.id)
          return {
            kind: 'success',
            text: 'approved one retry of: ' + picked.toolName + ' ' + picked.arguments.slice(0, 80) + ' (identity ' + picked.fingerprint.slice(0, 16) + '\u2026)' +
              '. Retry the EXACT action; it will be reviewed again with this approval as trusted evidence (critical-risk actions still deny).',
          }
        },
      }
      commands.register(approveDefinition)
    } else {
      log.warn('commands service unavailable; commands not registered')
    }
  } catch (error) {
    log.warn('commands unavailable: %s', String((error as Error)?.message ?? error))
  }
}
