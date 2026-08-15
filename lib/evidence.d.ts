import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval';
export interface ToolCallRecord {
    name: string;
    arguments: string;
}
/** Find the `tool/call` session event matching the pending approval callId. */
export declare function findToolCall(events: readonly SessionEvent[], callId: unknown): ToolCallRecord | null;
export declare function serializeRequest(req: Pick<ApprovalRequest, 'toolName' | 'callId' | 'reason'>, toolCall: ToolCallRecord | null): string;
/**
 * Exact action identity for denial tracking and /approve matching: the
 * canonical tool identity plus raw arguments plus the working directory.
 * The agent's stated reason is deliberately NOT part of the identity.
 */
export declare function actionFingerprint(toolName: string, argumentsText: string, cwd: string): string;
export interface PostDenialApproval {
    approved: true;
    denialId: number;
    exactActionFingerprint: string;
    oneRetry: true;
}
export interface UserEvidenceEntry {
    seq: number;
    text: string;
    /**
     * false = the message body was too long and is NOT shown (only seq and
     * sha256 are). A truncated user message can never authorize: its hidden
     * body might narrow or revoke earlier grants.
     */
    complete: boolean;
    /** Present exactly when complete=false: the sha256 identity of the omitted body. */
    sha256?: string;
}
/** Per-message cap for PRIOR user requests; the latest request is never capped. */
export declare const PRIOR_MESSAGE_MAX_CHARS = 800;
export interface Evidence {
    latestUserRequest: UserEvidenceEntry | null;
    priorUserRequests: UserEvidenceEntry[];
    untrustedExecution: string[];
    /** true when the latest user message exceeds the evidence budget — the caller must fail closed instead of reviewing a truncated authorization. */
    latestOverBudget: boolean;
}
export interface EvidenceBudget {
    enabled: boolean;
    maxMessages?: number;
    maxChars?: number;
    rawToolResults?: boolean;
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
export declare function buildEvidence(events: readonly SessionEvent[], budget: EvidenceBudget): Evidence;
