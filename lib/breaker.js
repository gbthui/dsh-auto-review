/** The turn number of the newest `turn/start` event (0 when unknown). */
export function currentTurn(events) {
    if (!events)
        return 0;
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (event?.type === 'turn/start')
            return Number(event.data?.turn ?? 0);
    }
    return 0;
}
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
export class Breaker {
    state = new Map();
    note(agentId, outcome, c, events) {
        const turn = currentTurn(events);
        let s = this.state.get(agentId);
        if (!s || s.turn !== turn) {
            s = { turn, consecutive: 0, window: [] };
            this.state.set(agentId, s);
        }
        if (outcome === 'deny') {
            s.consecutive++;
            s.window.push(true);
        }
        else {
            s.consecutive = 0;
            s.window.push(false);
        }
        if (s.window.length > Math.max(c.breaker.windowSize, 1))
            s.window.shift();
    }
    /** Non-null when the breaker should trip for this agent right now. */
    reason(agentId, c) {
        if (!c.breaker.enabled)
            return null;
        const s = this.state.get(agentId);
        if (!s)
            return null;
        if (s.consecutive >= c.breaker.consecutiveDenyLimit) {
            return 'circuit breaker: ' + s.consecutive + ' consecutive denials in this turn';
        }
        const windowDenies = s.window.filter(Boolean).length;
        if (c.breaker.windowDenyLimit > 0 && windowDenies >= c.breaker.windowDenyLimit) {
            return 'circuit breaker: ' + windowDenies + ' denials in the last ' + s.window.length + ' approval outcomes of this turn';
        }
        return null;
    }
    reset(agentId) {
        this.state.delete(agentId);
    }
}
