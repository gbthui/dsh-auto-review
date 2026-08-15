import { sha256 } from './util.js';
/** Find the `tool/call` session event matching the pending approval callId. */
export function findToolCall(events, callId) {
    if (!callId)
        return null;
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        const data = event?.data;
        if (event?.type === 'tool/call' && data?.callId === callId && typeof data.name === 'string' && typeof data.arguments === 'string') {
            return { name: data.name, arguments: data.arguments };
        }
    }
    return null;
}
export function serializeRequest(req, toolCall) {
    return JSON.stringify({
        tool: req.toolName,
        callId: req.callId ?? null,
        reason: req.reason ?? '',
        toolCall,
    });
}
/**
 * Exact action identity for denial tracking and /approve matching: the
 * canonical tool identity plus raw arguments plus the working directory.
 * The agent's stated reason is deliberately NOT part of the identity.
 */
export function actionFingerprint(toolName, argumentsText, cwd) {
    return sha256('tool: ' + toolName + '\nargs: ' + argumentsText + '\ncwd: ' + cwd);
}
function textOf(content) {
    if (!Array.isArray(content))
        return '';
    return content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n');
}
/** Per-message cap for PRIOR user requests; the latest request is never capped. */
export const PRIOR_MESSAGE_MAX_CHARS = 800;
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
export function buildEvidence(events, budget) {
    const empty = { latestUserRequest: null, priorUserRequests: [], untrustedExecution: [], latestOverBudget: false };
    if (!budget?.enabled)
        return empty;
    const maxChars = budget.maxChars ?? 6000;
    const maxItems = budget.maxMessages ?? 10;
    const rawToolResults = budget.rawToolResults === true;
    const users = [];
    let latestOverBudget = false;
    const others = [];
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        let line = null;
        if (event?.type === 'user/message') {
            const data = event.data;
            if (data?.source?.kind !== 'user')
                continue;
            const text = textOf(data.content);
            if (!text.trim())
                continue;
            if (users.length === 0) {
                // The LATEST user request is the authorization that may allow the
                // action: never truncate it. Flag overflow so the caller can fail
                // closed instead of reviewing a widened (head-only) authorization.
                latestOverBudget = text.length > maxChars;
                users.push({ seq: event.seq ?? i, text, complete: true });
            }
            else {
                // Historical messages only assist, but a truncated authorization is
                // the same widening hazard as the latest case: an overlong prior is
                // replaced by {seq, sha256} with NO body. Losing text may only
                // narrow what can be authorized — never widen it.
                users.push(text.length <= PRIOR_MESSAGE_MAX_CHARS
                    ? { seq: event.seq ?? i, text, complete: true }
                    : { seq: event.seq ?? i, text: '', complete: false, sha256: sha256(text) });
            }
            if (users.length >= maxItems && others.length >= maxItems)
                break;
            continue;
        }
        if (event?.type === 'assistant/message') {
            line = textOf(event.data?.message?.content);
        }
        else if (event?.type === 'tool/call') {
            const data = event.data;
            line = 'tool-call: ' + String(data.name) + ' ' + String(data.arguments ?? '').slice(0, 200);
        }
        else if (event?.type === 'tool/result') {
            const raw = textOf(event.data?.message?.content);
            line = rawToolResults
                ? 'tool-result: ' + raw.slice(0, 400)
                : 'tool-result: output ' + raw.length + ' chars, sha256 ' + sha256(raw).slice(0, 12);
        }
        if (!line || !line.trim())
            continue;
        const capped = line.slice(0, 800);
        if (others.length < maxItems)
            others.push(capped);
        if (users.length >= maxItems && others.length >= maxItems)
            break;
    }
    // The latest user request is kept unconditionally (overflow flagged);
    // prior requests fill the remaining budget, then the untrusted side.
    const trusted = [];
    let used = 0;
    if (users.length > 0) {
        trusted.push(users[0]);
        used += users[0].text.length;
    }
    for (const entry of users.slice(1)) {
        if (used + entry.text.length > maxChars)
            break;
        trusted.push(entry);
        used += entry.text.length;
    }
    const untrusted = [];
    for (const line of others) {
        if (used + line.length > maxChars)
            break;
        untrusted.push(line);
        used += line.length;
    }
    return {
        latestUserRequest: trusted[0] ?? null,
        priorUserRequests: trusted.slice(1),
        untrustedExecution: untrusted,
        latestOverBudget,
    };
}
