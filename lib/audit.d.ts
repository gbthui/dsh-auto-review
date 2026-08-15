import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval';
import type { ResolvedConfig } from './config.ts';
import type { ToolCallRecord } from './evidence.ts';
import { type LoggerLike } from './util.ts';
export interface AuditEntry {
    decision: 'allow' | 'deny';
    risk: string;
    reason: string;
    source: string;
    inputHash: string;
    durationMs: number;
    workspaceRoot: string;
    sandboxMode: string;
    toolCall: ToolCallRecord | null;
}
export interface Auditor {
    /** One JSON line per review decision; tool input as sha256 unless includeToolInput. */
    record(req: Pick<ApprovalRequest, 'toolName' | 'callId'>, agent: Agent | undefined, session: {
        id?: string;
        cwd?: string;
    } | undefined, entry: AuditEntry): Promise<void>;
}
/** The audit sink: every decision becomes one JSON line in the audit file. */
export declare function createAuditor(deps: {
    cfg: () => ResolvedConfig;
    log: LoggerLike;
}): Auditor;
