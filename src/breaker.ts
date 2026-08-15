import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ResolvedConfig } from './config.ts'

/** The turn number of the newest `turn/start` event (0 when unknown). */
export function currentTurn(events: readonly SessionEvent[] | undefined): number {
  if (!events) return 0
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type === 'turn/start') return Number((event.data as { turn?: unknown })?.turn ?? 0)
  }
  return 0
}

interface TurnState {
  turn: number
  consecutive: number
  window: boolean[]
}

/**
 * Per-agent circuit-breaker state for the current turn.
 * `deny` increments the consecutive count and records a deny in the rolling
 * window. `allow` and `unavailable` reset the consecutive count and record a
 * non-denial. State resets when the session moves to a new turn.
 */
export class Breaker {
  private readonly state = new Map<string, TurnState>()

  note(agentId: string, outcome: 'deny' | 'allow' | 'unavailable', c: ResolvedConfig, events?: readonly SessionEvent[]): void {
    const turn = currentTurn(events)
    let s = this.state.get(agentId)
    if (!s || s.turn !== turn) {
      s = { turn, consecutive: 0, window: [] }
      this.state.set(agentId, s)
    }
    if (outcome === 'deny') {
      s.consecutive++
      s.window.push(true)
    } else {
      s.consecutive = 0
      s.window.push(false)
    }
    if (s.window.length > Math.max(c.breaker.windowSize, 1)) s.window.shift()
  }

  /** Non-null when the breaker should trip for this agent right now. */
  reason(agentId: string, c: ResolvedConfig): string | null {
    if (!c.breaker.enabled) return null
    const s = this.state.get(agentId)
    if (!s) return null
    if (s.consecutive >= c.breaker.consecutiveDenyLimit) {
      return 'circuit breaker: ' + s.consecutive + ' consecutive denials in this turn'
    }
    const windowDenies = s.window.filter(Boolean).length
    if (c.breaker.windowDenyLimit > 0 && windowDenies >= c.breaker.windowDenyLimit) {
      return 'circuit breaker: ' + windowDenies + ' denials in the last ' + s.window.length + ' approval outcomes of this turn'
    }
    return null
  }

  reset(agentId: string): void {
    this.state.delete(agentId)
  }
}
