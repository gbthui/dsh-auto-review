import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { sha256 } from './util.ts'

export interface ToolCallRecord {
  name: string
  arguments: string
}

/** Find the `tool/call` session event matching the pending approval callId. */
export function findToolCall(events: readonly SessionEvent[], callId: unknown): ToolCallRecord | null {
  if (!callId) return null
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    const data = event?.data as { callId?: unknown; name?: unknown; arguments?: unknown } | undefined
    if (event?.type === 'tool/call' && data?.callId === callId && typeof data.name === 'string' && typeof data.arguments === 'string') {
      return { name: data.name, arguments: data.arguments }
    }
  }
  return null
}

export function serializeRequest(req: Pick<ApprovalRequest, 'toolName' | 'callId' | 'reason'>, toolCall: ToolCallRecord | null): string {
  return JSON.stringify({
    tool: req.toolName,
    callId: req.callId ?? null,
    reason: req.reason ?? '',
    toolCall,
  })
}

/**
 * Exact action identity for denial tracking and /approve matching: the
 * canonical tool identity plus raw arguments plus the working directory.
 * The agent's stated reason is deliberately NOT part of the identity.
 */
export function actionFingerprint(toolName: string, argumentsText: string, cwd: string): string {
  return sha256('tool: ' + toolName + '\nargs: ' + argumentsText + '\ncwd: ' + cwd)
}

export interface PostDenialApproval {
  approved: true
  denialId: number
  exactActionFingerprint: string
  oneRetry: true
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return (content as { type?: unknown; text?: unknown }[])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
}

export interface UserEvidenceEntry {
  seq: number
  text: string
  /**
   * false = the message body was too long and is NOT shown (only seq and
   * sha256 are). A truncated user message can never authorize: its hidden
   * body might narrow or revoke earlier grants.
   */
  complete: boolean
  /** Present exactly when complete=false: the sha256 identity of the omitted body. */
  sha256?: string
}

/** Per-message cap for PRIOR user requests; the latest request is never capped. */
export const PRIOR_MESSAGE_MAX_CHARS = 800

export interface Evidence {
  latestUserRequest: UserEvidenceEntry | null
  priorUserRequests: UserEvidenceEntry[]
  untrustedExecution: string[]
  /** true when the latest user message exceeds the evidence budget — the caller must fail closed instead of reviewing a truncated authorization. */
  latestOverBudget: boolean
}

export interface EvidenceBudget {
  enabled: boolean
  maxMessages?: number
  maxChars?: number
  rawToolResults?: boolean
}

/**
 * Structured reviewer evidence, split by trust class:
 *  - trusted: latest_user_request + prior_user_requests — the ONLY thing
 *    that can authorize permission; each entry carries its session sequence
 *    number so newer messages visibly outrank older ones, and a completeness
 *    flag. Overlong PRIOR messages are omitted entirely (seq + sha256 only):
 *    a truncated authorization must never reach the reviewer, because the
 *    hidden tail might narrow or revoke the grant the head appears to give.
 *    The LATEST request is never truncated — overflow is flagged so the
 *    caller can fail closed.
 *  - untrusted: assistant text, tool calls, and tool-result FACTS — raw
 *    tool-result text is excluded by default (distilled to length + sha256)
 *    and only included when budget.rawToolResults is on.
 * Injected context and reasoning blocks are excluded. User messages fill
 * the budget first; both lists are newest-first. Trimmed, never denied.
 */
export function buildEvidence(events: readonly SessionEvent[], budget: EvidenceBudget): Evidence {
  const empty: Evidence = { latestUserRequest: null, priorUserRequests: [], untrustedExecution: [], latestOverBudget: false }
  if (!budget?.enabled) return empty
  const maxChars = budget.maxChars ?? 6000
  const maxItems = budget.maxMessages ?? 10
  const rawToolResults = budget.rawToolResults === true
  const users: UserEvidenceEntry[] = []
  let latestOverBudget = false
  const others: string[] = []
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    let line: string | null = null
    if (event?.type === 'user/message') {
      const data = event.data as { source?: { kind?: unknown }; content?: unknown }
      if (data?.source?.kind !== 'user') continue
      const text = textOf(data.content)
      if (!text.trim()) continue
      if (users.length === 0) {
        // The LATEST user request is the authorization that may allow the
        // action: never truncate it. Flag overflow so the caller can fail
        // closed instead of reviewing a widened (head-only) authorization.
        latestOverBudget = text.length > maxChars
        users.push({ seq: event.seq ?? i, text, complete: true })
      } else {
        // Historical messages only assist, but a truncated authorization is
        // the same widening hazard as the latest case: an overlong prior is
        // replaced by {seq, sha256} with NO body. Losing text may only
        // narrow what can be authorized — never widen it.
        users.push(
          text.length <= PRIOR_MESSAGE_MAX_CHARS
            ? { seq: event.seq ?? i, text, complete: true }
            : { seq: event.seq ?? i, text: '', complete: false, sha256: sha256(text) },
        )
      }
      if (users.length >= maxItems && others.length >= maxItems) break
      continue
    }
    if (event?.type === 'assistant/message') {
      line = textOf((event.data as { message?: { content?: unknown } })?.message?.content)
    } else if (event?.type === 'tool/call') {
      const data = event.data as { name?: unknown; arguments?: unknown }
      line = 'tool-call: ' + String(data.name) + ' ' + String(data.arguments ?? '').slice(0, 200)
    } else if (event?.type === 'tool/result') {
      const raw = textOf((event.data as { message?: { content?: unknown } })?.message?.content)
      line = rawToolResults
        ? 'tool-result: ' + raw.slice(0, 400)
        : 'tool-result: output ' + raw.length + ' chars, sha256 ' + sha256(raw).slice(0, 12)
    }
    if (!line || !line.trim()) continue
    const capped = line.slice(0, 800)
    if (others.length < maxItems) others.push(capped)
    if (users.length >= maxItems && others.length >= maxItems) break
  }
  // The latest user request is kept unconditionally (overflow flagged);
  // prior requests fill the remaining budget, then the untrusted side.
  const trusted: UserEvidenceEntry[] = []
  let used = 0
  if (users.length > 0) {
    trusted.push(users[0])
    used += users[0].text.length
  }
  for (const entry of users.slice(1)) {
    if (used + entry.text.length > maxChars) break
    trusted.push(entry)
    used += entry.text.length
  }
  const untrusted: string[] = []
  for (const line of others) {
    if (used + line.length > maxChars) break
    untrusted.push(line)
    used += line.length
  }
  return {
    latestUserRequest: trusted[0] ?? null,
    priorUserRequests: trusted.slice(1),
    untrustedExecution: untrusted,
    latestOverBudget,
  }
}
