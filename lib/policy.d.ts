import type { ResolvedConfig } from './config.ts';
/**
 * Default reviewer system prompt: the guardian policy the reviewer applies.
 *
 * Keep this LEAN. The reviewer makes every risk judgment; code only enforces
 * facts it can know exactly, such as strict JSON, critical never allowing,
 * and complete authorization evidence. This prompt states principles, not
 * case law: before adding a case-specific rule, fold it into an existing
 * principle (a smoke test ratchets the total length).
 */
export declare const DEFAULT_REVIEWER_POLICY: string;
/**
 * Validate every security-sensitive config field. Null = the config is
 * usable; otherwise the message names the exact problem. A config that
 * fails this check must never be armed or applied: typed allow rules must
 * be well-formed and escalation rules must pin operations (a no-review
 * grant needs a concrete action shape).
 */
export declare function validateConfig(c: ResolvedConfig): string | null;
