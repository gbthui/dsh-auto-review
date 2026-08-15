import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ResolvedConfig } from './config.ts';
/** The turn number of the newest `turn/start` event (0 when unknown). */
export declare function currentTurn(events: readonly SessionEvent[] | undefined): number;
/**
 * Per-agent denial bookkeeping for the circuit breaker.
 *  - 'deny' counts toward the breaker: consecutive++ and a deny slot in
 *    the rolling window;
 *  - ANY non-denial — 'allow' AND 'unavailable' — resets the consecutive
 *    counter (Codex semantics: any non-denial resets it). Neither counts
 *    as a deny in the window: reviewer infra failure is not evidence of
 *    danger, it just breaks a denial streak.
 * Counters reset when the session moves to a new turn.
 */
export declare class Breaker {
    private readonly state;
    note(agentId: string, outcome: 'deny' | 'allow' | 'unavailable', c: ResolvedConfig, events?: readonly SessionEvent[]): void;
    /** Non-null when the breaker should trip for this agent right now. */
    reason(agentId: string, c: ResolvedConfig): string | null;
    reset(agentId: string): void;
}
