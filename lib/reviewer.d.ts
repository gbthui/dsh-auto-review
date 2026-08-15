import { type StreamChunk } from '@deepseek-ai/dsh-llm';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval';
import type { Evidence, PostDenialApproval, ToolCallRecord } from './evidence.ts';
import { type FactObservation, type FactQuery } from './facts.ts';
export interface Verdict {
    decision: 'allow' | 'deny';
    risk: 'low' | 'medium' | 'high' | 'critical';
    reason: string;
}
export type ReviewerReply = {
    kind: 'verdict';
    verdict: Verdict;
} | {
    kind: 'fact-request';
    queries: FactQuery[];
};
/**
 * Parse the reviewer free-form JSON verdict (tolerates code fences and
 * surrounding prose). Throws on anything unusable — callers fail closed.
 */
export declare function parseVerdict(text: string): Verdict;
/**
 * Parse a reviewer reply: either a final verdict, or a bounded fact request.
 * Unknown fact tools or malformed queries throw — callers fail closed.
 */
export declare function parseReviewerReply(text: string): ReviewerReply;
export interface ReviewerPrompt {
    system: string;
    user: string;
}
/** One OpenAI-compatible chat completion against the reviewer endpoint. */
export interface ReviewerEndpointConfig {
    baseURL?: string;
    model?: string;
    apiKey?: string;
    apiKeyEnv?: string;
    apiKeyFile?: string;
    timeoutMs?: number;
    maxTokens?: number;
    thinking?: 'default' | 'off';
}
export declare function resolveApiKey(reviewer: {
    apiKey?: string;
    apiKeyEnv?: string;
    apiKeyFile?: string;
}): Promise<string | null>;
export declare function callReviewer(reviewer: ReviewerEndpointConfig, prompt: ReviewerPrompt, signal?: AbortSignal): Promise<string>;
export interface SessionModelLlmRuntime {
    stream(options: {
        provider: string;
        model: string;
        messages: unknown[];
        system?: string;
        maxTokens?: number;
        reasoningEffort?: string;
        signal?: AbortSignal;
    }): AsyncIterable<StreamChunk>;
}
export interface SessionModelReviewerCtx {
    get(name: string): unknown;
}
/**
 * Review with the calling session's current model: the harness's own LLM
 * runtime, routed to the exact provider/model the agent uses. Credentials
 * come from the harness (credentials seam / provider env), not from this
 * plugin. Used when no explicit reviewer endpoint is configured.
 */
export declare function reviewWithSessionModel(ctx: SessionModelReviewerCtx, agent: Agent | undefined, reviewer: {
    timeoutMs?: number;
    maxTokens?: number;
    thinking?: 'default' | 'off';
}, prompt: ReviewerPrompt, signal?: AbortSignal): Promise<string>;
export declare function buildPrompt(req: Pick<ApprovalRequest, 'toolName' | 'reason'>, toolCall: ToolCallRecord | null, facts: {
    workspaceRoot?: string;
    sandboxMode?: string;
}, evidence: Evidence, override?: PostDenialApproval | null, factObservations?: readonly FactObservation[]): ReviewerPrompt;
