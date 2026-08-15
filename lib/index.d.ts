/**
 * dsh-auto-review — reviewer-substitution answerer for DeepSeek Harness.
 *
 * What it does (Codex auto-review semantics mapped onto the DSH approval seam):
 *   - Registers a PREPENDED answerer on the `approval/request` waterfall, so
 *     approval asks (primarily sandbox-escalation retries) are decided by a
 *     reviewer model before the interactive GUI answerer ever sees them.
 *   - Fail-closed integrity checks first: an input truncation guard (never
 *     hand a truncated input to the reviewer) and a tool-call resolution
 *     guard (never allow arguments the reviewer cannot see). The reviewer
 *     makes every risk judgment; code does not try to parse shell commands.
 *   - On reviewer failure it fails closed (configurable to delegate to the
 *     human answerer instead).
 *   - Denials inject an anti-circumvention notice into the model-facing
 *     context, and a circuit breaker (3 consecutive denials, or 10 denials in
 *     the last 50 reviews) cancels the agent turn to stop denial loops.
 *   - Every decision appends one JSON line to an audit file; tool input is
 *     stored as a sha256 hash unless `includeToolInput` is enabled.
 *   - The verdict must come from the model's FINAL answer; chain-of-thought
 *     output is never parsed as an authorization.
 *
 * Module map (security boundary code, split for auditability):
 *   meta / config / policy  — identity, schema, reviewer policy
 *   evidence                — trusted vs untrusted evidence, authorization
 *                             completeness (never truncate an authorization)
 *   facts                   — bounded read-only fact tools (hardened git)
 *   reviewer                — endpoint + session-model review, verdict parsing
 *   approval-answerer       — the decision pipeline + /approve denial ledger
 *   breaker                 — per-turn denial circuit breaker
 *   audit                   — JSONL audit sink
 *
 * @module dsh-auto-review
 */
import type { Context } from '@deepseek-ai/cordis';
import type { PluginContext } from './util.ts';
export { name, NS, inject } from './meta.ts';
export { Config, type ResolvedConfig } from './config.ts';
export { DEFAULT_REVIEWER_POLICY, validateConfig } from './policy.ts';
export { sha256, expandHome, type LoggerLike, type PluginContext } from './util.ts';
export { buildEvidence, findToolCall, serializeRequest, actionFingerprint, PRIOR_MESSAGE_MAX_CHARS, type UserEvidenceEntry, type Evidence, type EvidenceBudget, type PostDenialApproval, type ToolCallRecord, } from './evidence.ts';
export { executeFacts, sanitizeGitUrl, isSensitiveContentPath, CONTENT_DENY_PATH_PATTERNS, FACT_TOOLS, type FactQuery, type FactObservation, type FactExecutionOptions, } from './facts.ts';
export { parseVerdict, parseReviewerReply, buildPrompt, callReviewer, reviewWithSessionModel, resolveApiKey, type Verdict, type ReviewerReply, type ReviewerPrompt, type ReviewerEndpointConfig, type SessionModelLlmRuntime, type SessionModelReviewerCtx, } from './reviewer.ts';
export { Breaker, currentTurn } from './breaker.ts';
export { createAuditor, type Auditor, type AuditEntry } from './audit.ts';
export { createAnswerer, reviewOnceWithParseRetry, matchAllowRule, DenialLedger, type AllowRule, type Answerer, type AnswererDeps, type DenialRecord } from './approval-answerer.ts';
/**
 * The plugin: a prepended `approval/request` answerer. Wires the settings
 * scope, the breaker/audit/ledger instances, and the composer commands.
 */
export declare function apply(ctx: Context | PluginContext, config?: unknown): void;
