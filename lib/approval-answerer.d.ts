import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval';
import { type LoggerLike, type PluginContext } from './util.ts';
import type { ResolvedConfig } from './config.ts';
import { type PostDenialApproval, type ToolCallRecord } from './evidence.ts';
import { type ReviewerReply } from './reviewer.ts';
import { Breaker } from './breaker.ts';
import type { Auditor } from './audit.ts';
/**
 * Denial records for /approve: the ONLY in-memory source of exact-action
 * re-authorization. PER-SESSION ring of 10 (Codex semantics: up to 10
 * recent denials per task) — one session's flood never evicts another
 * session's records. Cleared on restart by design.
 */
export interface DenialRecord {
    id: number;
    sessionId: string;
    toolName: string;
    arguments: string;
    cwd: string;
    fingerprint: string;
    risk: string;
    reason: string;
    timestamp: number;
}
export declare class DenialLedger {
    private readonly bySession;
    private readonly overrides;
    private nextId;
    record(entry: {
        sessionId: string;
        toolName: string;
        arguments: string;
        cwd: string;
        risk: string;
        reason: string;
    }): DenialRecord;
    /** Newest-first denials for one session (at most 10). */
    list(sessionId: string): DenialRecord[];
    /** Grant one retry override for the exact denial id; null when not found. */
    grant(sessionId: string, denialId: number): DenialRecord | null;
    /**
     * Consume one pending override for an exact action fingerprint. This only
     * ADDS trusted evidence — the reviewer re-judges and critical still denies.
     */
    consume(sessionId: string, fingerprint: string): PostDenialApproval | null;
}
export interface AnswererDeps {
    ctx: PluginContext;
    getService: (name: string) => unknown;
    cfg: () => ResolvedConfig;
    log: LoggerLike;
    breaker: Breaker;
    auditor: Auditor;
    ledger: DenialLedger;
}
export type Answerer = (req: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>;
export interface AllowRule {
    tool: string;
    operations: string[];
    escalationTarget: string;
}
/**
 * Typed no-review allow matching. The rule shape is deliberately
 * inexpressive so a misconfigured rule cannot become a permission
 * incident: exact tool name, literal operation PREFIXES (against the
 * call's `command` / `operation` / `script` argument field), and — for
 * escalation asks only — an explicit target that is structurally capped
 * at `workspace-write` (danger-full-access never matches). Unstructured
 * or unparseable arguments never match: the reviewer decides.
 */
export declare function matchAllowRule(rules: readonly AllowRule[], toolCall: ToolCallRecord): AllowRule | null;
/**
 * One review with a single corrective retry for UNPARSEABLE replies (e.g.
 * unescaped quotes breaking the verdict JSON): the model gets one chance to
 * fix its formatting, then the error propagates and the caller fails closed.
 * The retried output goes through the exact same strict parser — nothing is
 * relaxed, and only the parser's own error message is fed back.
 */
export declare function reviewOnceWithParseRetry(review: (systemText: string) => Promise<string>, system: string): Promise<ReviewerReply>;
/**
 * The `approval/request` answerer: fail-closed integrity checks, then the
 * reviewer (endpoint or session model), then verdict handling with breaker
 * and denial ledger. It is registered PREPENDED by apply(), so approval
 * asks are decided before the interactive answerer ever sees them.
 */
export declare function createAnswerer(deps: AnswererDeps): Answerer;
