import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ResolvedConfig } from './config.ts';
/** The turn number of the newest `turn/start` event (0 when unknown). */
export declare function currentTurn(events: readonly SessionEvent[] | undefined): number;
/**
 * Per-agent circuit-breaker state for the current turn.
 * `deny` increments the consecutive count and records a deny in the rolling
 * window. `allow` and `unavailable` reset the consecutive count and record a
 * non-denial. State resets when the session moves to a new turn.
 */
export declare class Breaker {
    private readonly state;
    note(agentId: string, outcome: 'deny' | 'allow' | 'unavailable', c: ResolvedConfig, events?: readonly SessionEvent[]): void;
    /** Non-null when the breaker should trip for this agent right now. */
    reason(agentId: string, c: ResolvedConfig): string | null;
    reset(agentId: string): void;
}
