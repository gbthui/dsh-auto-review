import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ResolvedConfig } from './config.ts';
/** The turn number of the newest `turn/start` event (0 when unknown). */
export declare function currentTurn(events: readonly SessionEvent[] | undefined): number;
/**
 * Per-agent denial bookkeeping for the circuit breaker.
 *  - 'deny' counts toward the breaker: consecutive++ and a deny slot in
 *    the rolling window;
 *  - ANY non-denial — 'allow' AND 'unavailable' — resets the consecutive
 *    counter. Neither counts as a deny in the rolling window: reviewer
 *    unavailability is not evidence of danger, but it does break a denial
 *    streak.
 * The rolling window counts approval outcomes observed by the breaker, not
 * reviewer calls. Counters reset when the session moves to a new turn.
 */
export declare class Breaker {
    private readonly state;
    note(agentId: string, outcome: 'deny' | 'allow' | 'unavailable', c: ResolvedConfig, events?: readonly SessionEvent[]): void;
    /** Non-null when the breaker should trip for this agent right now. */
    reason(agentId: string, c: ResolvedConfig): string | null;
    reset(agentId: string): void;
}
