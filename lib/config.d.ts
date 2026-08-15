import z from '@deepseek-ai/schemastery';
export declare const Config: z<Schemastery.ObjectS<{
    enabled: z<boolean, boolean>;
    reviewer: z<Schemastery.ObjectS<{
        /** Empty baseURL = review with the session's current model via ctx.llm. */
        baseURL: z<string, string>;
        model: z<string, string>;
        apiKey: z<string, string>;
        apiKeyEnv: z<string, string>;
        apiKeyFile: z<string, string>;
        timeoutMs: z<number, number>;
        /** Verdict JSON is ~100-300 tokens; the cap only guards runaway output. */
        maxTokens: z<number, number>;
        /**
         * Request-side reasoning control. The verdict ALWAYS comes from the
         * final answer — chain-of-thought output is never parsed as an
         * authorization. 'off' disables reasoning on the request side so the
         * final answer lands deterministically (endpoint path sends DeepSeek's
         * `thinking:{type:disabled}`; session path maps to the adapter's
         * 'off' effort on `deepseek-official`).
         */
        thinking: z<"default" | "off", "default" | "off">;
        extraSystemPrompt: z<string, string>;
        /**
         * Bounded read-only fact finding: the reviewer may ask for a few LOCAL
         * metadata facts (paths, directory stats, git remote/status) before its
         * final verdict. Fixed semantic tools only — no shell, no network, no
         * escalation, never a new approval ask. File CONTENT is never exposed.
         */
        factFinding: z<Schemastery.ObjectS<{
            enabled: z<boolean, boolean>;
            maxRounds: z<number, number>;
            maxFacts: z<number, number>;
            /**
             * File-CONTENT inspection (inspect_text_file). OFF by default.
             * When an external reviewer.baseURL is configured, enabling this
             * explicitly allows bounded workspace content to be sent there.
             * Workspace-only, binary-denied, sensitive-path-denied, capped.
             */
            content: z<Schemastery.ObjectS<{
                enabled: z<boolean, boolean>;
                maxBytes: z<number, number>;
            }>, Schemastery.ObjectT<{
                enabled: z<boolean, boolean>;
                maxBytes: z<number, number>;
            }>>;
        }>, Schemastery.ObjectT<{
            enabled: z<boolean, boolean>;
            maxRounds: z<number, number>;
            maxFacts: z<number, number>;
            /**
             * File-CONTENT inspection (inspect_text_file). OFF by default.
             * When an external reviewer.baseURL is configured, enabling this
             * explicitly allows bounded workspace content to be sent there.
             * Workspace-only, binary-denied, sensitive-path-denied, capped.
             */
            content: z<Schemastery.ObjectS<{
                enabled: z<boolean, boolean>;
                maxBytes: z<number, number>;
            }>, Schemastery.ObjectT<{
                enabled: z<boolean, boolean>;
                maxBytes: z<number, number>;
            }>>;
        }>>;
    }>, Schemastery.ObjectT<{
        /** Empty baseURL = review with the session's current model via ctx.llm. */
        baseURL: z<string, string>;
        model: z<string, string>;
        apiKey: z<string, string>;
        apiKeyEnv: z<string, string>;
        apiKeyFile: z<string, string>;
        timeoutMs: z<number, number>;
        /** Verdict JSON is ~100-300 tokens; the cap only guards runaway output. */
        maxTokens: z<number, number>;
        /**
         * Request-side reasoning control. The verdict ALWAYS comes from the
         * final answer — chain-of-thought output is never parsed as an
         * authorization. 'off' disables reasoning on the request side so the
         * final answer lands deterministically (endpoint path sends DeepSeek's
         * `thinking:{type:disabled}`; session path maps to the adapter's
         * 'off' effort on `deepseek-official`).
         */
        thinking: z<"default" | "off", "default" | "off">;
        extraSystemPrompt: z<string, string>;
        /**
         * Bounded read-only fact finding: the reviewer may ask for a few LOCAL
         * metadata facts (paths, directory stats, git remote/status) before its
         * final verdict. Fixed semantic tools only — no shell, no network, no
         * escalation, never a new approval ask. File CONTENT is never exposed.
         */
        factFinding: z<Schemastery.ObjectS<{
            enabled: z<boolean, boolean>;
            maxRounds: z<number, number>;
            maxFacts: z<number, number>;
            /**
             * File-CONTENT inspection (inspect_text_file). OFF by default.
             * When an external reviewer.baseURL is configured, enabling this
             * explicitly allows bounded workspace content to be sent there.
             * Workspace-only, binary-denied, sensitive-path-denied, capped.
             */
            content: z<Schemastery.ObjectS<{
                enabled: z<boolean, boolean>;
                maxBytes: z<number, number>;
            }>, Schemastery.ObjectT<{
                enabled: z<boolean, boolean>;
                maxBytes: z<number, number>;
            }>>;
        }>, Schemastery.ObjectT<{
            enabled: z<boolean, boolean>;
            maxRounds: z<number, number>;
            maxFacts: z<number, number>;
            /**
             * File-CONTENT inspection (inspect_text_file). OFF by default.
             * When an external reviewer.baseURL is configured, enabling this
             * explicitly allows bounded workspace content to be sent there.
             * Workspace-only, binary-denied, sensitive-path-denied, capped.
             */
            content: z<Schemastery.ObjectS<{
                enabled: z<boolean, boolean>;
                maxBytes: z<number, number>;
            }>, Schemastery.ObjectT<{
                enabled: z<boolean, boolean>;
                maxBytes: z<number, number>;
            }>>;
        }>>;
    }>>;
    policy: z<Schemastery.ObjectS<{
        /** Tool names the reviewer answers for; empty = every approval ask. */
        tools: z<string[], string[]>;
        /**
         * TYPED no-review allow rules. A match grants the pending approval
         * (`allowed-once`) WITHOUT review, so the shape is deliberately
         * inexpressive: exact tool name + literal operation prefixes + (for
         * escalation asks) an explicit target that can never exceed
         * `workspace-write`. No regexes — an allow false positive is a
         * permission incident, which is exactly why this path is deliberately
         * inexpressive.
         */
        allowRules: z<({
            tool?: string | null | undefined;
            operations?: string[] | null | undefined;
            escalationTarget?: string | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<{
            /** Exact tool name the rule applies to (e.g. 'bash'). */
            tool: z<string, string>;
            /**
             * Literal operation prefixes (e.g. 'git status', 'mkdir -p ./dist').
             * The operation is the call's `command` / `operation` / `script`
             * argument field. Empty = any operation (plain asks only; an
             * escalation rule must pin operations).
             */
            operations: z<string[], string[]>;
            /**
             * '' = plain asks only. 'workspace-write' = this rule may also grant
             * escalation asks whose requested target is EXACTLY workspace-write.
             * danger-full-access is structurally ungrantable here.
             */
            escalationTarget: z<string, string>;
        }>[]>;
        maxInputChars: z<number, number>;
        /** true = reviewer errors resolve to 'unavailable' (fail closed, neutral for the breaker); false = delegate to the next answerer (human). */
        denyOnReviewerError: z<boolean, boolean>;
        /**
         * Structured evidence for the reviewer: recent human prompts (trusted
         * authorization, seq-tagged) plus untrusted execution context (assistant
         * text, tool calls, and tool-result facts). Reasoning blocks and
         * plugin-injected context are never included. The evidence only ever
         * gets trimmed — it never causes a denial.
         */
        context: z<Schemastery.ObjectS<{
            enabled: z<boolean, boolean>;
            maxMessages: z<number, number>;
            maxChars: z<number, number>;
            /**
             * false (default): tool results reach the reviewer only as distilled
             * facts (output length + sha256), never raw text — raw tool output is
             * the main prompt-injection surface. true (debug/enhanced mode) also
             * includes capped raw result text.
             */
            rawToolResults: z<boolean, boolean>;
        }>, Schemastery.ObjectT<{
            enabled: z<boolean, boolean>;
            maxMessages: z<number, number>;
            maxChars: z<number, number>;
            /**
             * false (default): tool results reach the reviewer only as distilled
             * facts (output length + sha256), never raw text — raw tool output is
             * the main prompt-injection surface. true (debug/enhanced mode) also
             * includes capped raw result text.
             */
            rawToolResults: z<boolean, boolean>;
        }>>;
    }>, Schemastery.ObjectT<{
        /** Tool names the reviewer answers for; empty = every approval ask. */
        tools: z<string[], string[]>;
        /**
         * TYPED no-review allow rules. A match grants the pending approval
         * (`allowed-once`) WITHOUT review, so the shape is deliberately
         * inexpressive: exact tool name + literal operation prefixes + (for
         * escalation asks) an explicit target that can never exceed
         * `workspace-write`. No regexes — an allow false positive is a
         * permission incident, which is exactly why this path is deliberately
         * inexpressive.
         */
        allowRules: z<({
            tool?: string | null | undefined;
            operations?: string[] | null | undefined;
            escalationTarget?: string | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<{
            /** Exact tool name the rule applies to (e.g. 'bash'). */
            tool: z<string, string>;
            /**
             * Literal operation prefixes (e.g. 'git status', 'mkdir -p ./dist').
             * The operation is the call's `command` / `operation` / `script`
             * argument field. Empty = any operation (plain asks only; an
             * escalation rule must pin operations).
             */
            operations: z<string[], string[]>;
            /**
             * '' = plain asks only. 'workspace-write' = this rule may also grant
             * escalation asks whose requested target is EXACTLY workspace-write.
             * danger-full-access is structurally ungrantable here.
             */
            escalationTarget: z<string, string>;
        }>[]>;
        maxInputChars: z<number, number>;
        /** true = reviewer errors resolve to 'unavailable' (fail closed, neutral for the breaker); false = delegate to the next answerer (human). */
        denyOnReviewerError: z<boolean, boolean>;
        /**
         * Structured evidence for the reviewer: recent human prompts (trusted
         * authorization, seq-tagged) plus untrusted execution context (assistant
         * text, tool calls, and tool-result facts). Reasoning blocks and
         * plugin-injected context are never included. The evidence only ever
         * gets trimmed — it never causes a denial.
         */
        context: z<Schemastery.ObjectS<{
            enabled: z<boolean, boolean>;
            maxMessages: z<number, number>;
            maxChars: z<number, number>;
            /**
             * false (default): tool results reach the reviewer only as distilled
             * facts (output length + sha256), never raw text — raw tool output is
             * the main prompt-injection surface. true (debug/enhanced mode) also
             * includes capped raw result text.
             */
            rawToolResults: z<boolean, boolean>;
        }>, Schemastery.ObjectT<{
            enabled: z<boolean, boolean>;
            maxMessages: z<number, number>;
            maxChars: z<number, number>;
            /**
             * false (default): tool results reach the reviewer only as distilled
             * facts (output length + sha256), never raw text — raw tool output is
             * the main prompt-injection surface. true (debug/enhanced mode) also
             * includes capped raw result text.
             */
            rawToolResults: z<boolean, boolean>;
        }>>;
    }>>;
    breaker: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        consecutiveDenyLimit: z<number, number>;
        windowSize: z<number, number>;
        windowDenyLimit: z<number, number>;
        action: z<"cancel" | "inject" | "off", "cancel" | "inject" | "off">;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        consecutiveDenyLimit: z<number, number>;
        windowSize: z<number, number>;
        windowDenyLimit: z<number, number>;
        action: z<"cancel" | "inject" | "off", "cancel" | "inject" | "off">;
    }>>;
    audit: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        path: z<string, string>;
        includeToolInput: z<boolean, boolean>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        path: z<string, string>;
        includeToolInput: z<boolean, boolean>;
    }>>;
}>, Schemastery.ObjectT<{
    enabled: z<boolean, boolean>;
    reviewer: z<Schemastery.ObjectS<{
        /** Empty baseURL = review with the session's current model via ctx.llm. */
        baseURL: z<string, string>;
        model: z<string, string>;
        apiKey: z<string, string>;
        apiKeyEnv: z<string, string>;
        apiKeyFile: z<string, string>;
        timeoutMs: z<number, number>;
        /** Verdict JSON is ~100-300 tokens; the cap only guards runaway output. */
        maxTokens: z<number, number>;
        /**
         * Request-side reasoning control. The verdict ALWAYS comes from the
         * final answer — chain-of-thought output is never parsed as an
         * authorization. 'off' disables reasoning on the request side so the
         * final answer lands deterministically (endpoint path sends DeepSeek's
         * `thinking:{type:disabled}`; session path maps to the adapter's
         * 'off' effort on `deepseek-official`).
         */
        thinking: z<"default" | "off", "default" | "off">;
        extraSystemPrompt: z<string, string>;
        /**
         * Bounded read-only fact finding: the reviewer may ask for a few LOCAL
         * metadata facts (paths, directory stats, git remote/status) before its
         * final verdict. Fixed semantic tools only — no shell, no network, no
         * escalation, never a new approval ask. File CONTENT is never exposed.
         */
        factFinding: z<Schemastery.ObjectS<{
            enabled: z<boolean, boolean>;
            maxRounds: z<number, number>;
            maxFacts: z<number, number>;
            /**
             * File-CONTENT inspection (inspect_text_file). OFF by default.
             * When an external reviewer.baseURL is configured, enabling this
             * explicitly allows bounded workspace content to be sent there.
             * Workspace-only, binary-denied, sensitive-path-denied, capped.
             */
            content: z<Schemastery.ObjectS<{
                enabled: z<boolean, boolean>;
                maxBytes: z<number, number>;
            }>, Schemastery.ObjectT<{
                enabled: z<boolean, boolean>;
                maxBytes: z<number, number>;
            }>>;
        }>, Schemastery.ObjectT<{
            enabled: z<boolean, boolean>;
            maxRounds: z<number, number>;
            maxFacts: z<number, number>;
            /**
             * File-CONTENT inspection (inspect_text_file). OFF by default.
             * When an external reviewer.baseURL is configured, enabling this
             * explicitly allows bounded workspace content to be sent there.
             * Workspace-only, binary-denied, sensitive-path-denied, capped.
             */
            content: z<Schemastery.ObjectS<{
                enabled: z<boolean, boolean>;
                maxBytes: z<number, number>;
            }>, Schemastery.ObjectT<{
                enabled: z<boolean, boolean>;
                maxBytes: z<number, number>;
            }>>;
        }>>;
    }>, Schemastery.ObjectT<{
        /** Empty baseURL = review with the session's current model via ctx.llm. */
        baseURL: z<string, string>;
        model: z<string, string>;
        apiKey: z<string, string>;
        apiKeyEnv: z<string, string>;
        apiKeyFile: z<string, string>;
        timeoutMs: z<number, number>;
        /** Verdict JSON is ~100-300 tokens; the cap only guards runaway output. */
        maxTokens: z<number, number>;
        /**
         * Request-side reasoning control. The verdict ALWAYS comes from the
         * final answer — chain-of-thought output is never parsed as an
         * authorization. 'off' disables reasoning on the request side so the
         * final answer lands deterministically (endpoint path sends DeepSeek's
         * `thinking:{type:disabled}`; session path maps to the adapter's
         * 'off' effort on `deepseek-official`).
         */
        thinking: z<"default" | "off", "default" | "off">;
        extraSystemPrompt: z<string, string>;
        /**
         * Bounded read-only fact finding: the reviewer may ask for a few LOCAL
         * metadata facts (paths, directory stats, git remote/status) before its
         * final verdict. Fixed semantic tools only — no shell, no network, no
         * escalation, never a new approval ask. File CONTENT is never exposed.
         */
        factFinding: z<Schemastery.ObjectS<{
            enabled: z<boolean, boolean>;
            maxRounds: z<number, number>;
            maxFacts: z<number, number>;
            /**
             * File-CONTENT inspection (inspect_text_file). OFF by default.
             * When an external reviewer.baseURL is configured, enabling this
             * explicitly allows bounded workspace content to be sent there.
             * Workspace-only, binary-denied, sensitive-path-denied, capped.
             */
            content: z<Schemastery.ObjectS<{
                enabled: z<boolean, boolean>;
                maxBytes: z<number, number>;
            }>, Schemastery.ObjectT<{
                enabled: z<boolean, boolean>;
                maxBytes: z<number, number>;
            }>>;
        }>, Schemastery.ObjectT<{
            enabled: z<boolean, boolean>;
            maxRounds: z<number, number>;
            maxFacts: z<number, number>;
            /**
             * File-CONTENT inspection (inspect_text_file). OFF by default.
             * When an external reviewer.baseURL is configured, enabling this
             * explicitly allows bounded workspace content to be sent there.
             * Workspace-only, binary-denied, sensitive-path-denied, capped.
             */
            content: z<Schemastery.ObjectS<{
                enabled: z<boolean, boolean>;
                maxBytes: z<number, number>;
            }>, Schemastery.ObjectT<{
                enabled: z<boolean, boolean>;
                maxBytes: z<number, number>;
            }>>;
        }>>;
    }>>;
    policy: z<Schemastery.ObjectS<{
        /** Tool names the reviewer answers for; empty = every approval ask. */
        tools: z<string[], string[]>;
        /**
         * TYPED no-review allow rules. A match grants the pending approval
         * (`allowed-once`) WITHOUT review, so the shape is deliberately
         * inexpressive: exact tool name + literal operation prefixes + (for
         * escalation asks) an explicit target that can never exceed
         * `workspace-write`. No regexes — an allow false positive is a
         * permission incident, which is exactly why this path is deliberately
         * inexpressive.
         */
        allowRules: z<({
            tool?: string | null | undefined;
            operations?: string[] | null | undefined;
            escalationTarget?: string | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<{
            /** Exact tool name the rule applies to (e.g. 'bash'). */
            tool: z<string, string>;
            /**
             * Literal operation prefixes (e.g. 'git status', 'mkdir -p ./dist').
             * The operation is the call's `command` / `operation` / `script`
             * argument field. Empty = any operation (plain asks only; an
             * escalation rule must pin operations).
             */
            operations: z<string[], string[]>;
            /**
             * '' = plain asks only. 'workspace-write' = this rule may also grant
             * escalation asks whose requested target is EXACTLY workspace-write.
             * danger-full-access is structurally ungrantable here.
             */
            escalationTarget: z<string, string>;
        }>[]>;
        maxInputChars: z<number, number>;
        /** true = reviewer errors resolve to 'unavailable' (fail closed, neutral for the breaker); false = delegate to the next answerer (human). */
        denyOnReviewerError: z<boolean, boolean>;
        /**
         * Structured evidence for the reviewer: recent human prompts (trusted
         * authorization, seq-tagged) plus untrusted execution context (assistant
         * text, tool calls, and tool-result facts). Reasoning blocks and
         * plugin-injected context are never included. The evidence only ever
         * gets trimmed — it never causes a denial.
         */
        context: z<Schemastery.ObjectS<{
            enabled: z<boolean, boolean>;
            maxMessages: z<number, number>;
            maxChars: z<number, number>;
            /**
             * false (default): tool results reach the reviewer only as distilled
             * facts (output length + sha256), never raw text — raw tool output is
             * the main prompt-injection surface. true (debug/enhanced mode) also
             * includes capped raw result text.
             */
            rawToolResults: z<boolean, boolean>;
        }>, Schemastery.ObjectT<{
            enabled: z<boolean, boolean>;
            maxMessages: z<number, number>;
            maxChars: z<number, number>;
            /**
             * false (default): tool results reach the reviewer only as distilled
             * facts (output length + sha256), never raw text — raw tool output is
             * the main prompt-injection surface. true (debug/enhanced mode) also
             * includes capped raw result text.
             */
            rawToolResults: z<boolean, boolean>;
        }>>;
    }>, Schemastery.ObjectT<{
        /** Tool names the reviewer answers for; empty = every approval ask. */
        tools: z<string[], string[]>;
        /**
         * TYPED no-review allow rules. A match grants the pending approval
         * (`allowed-once`) WITHOUT review, so the shape is deliberately
         * inexpressive: exact tool name + literal operation prefixes + (for
         * escalation asks) an explicit target that can never exceed
         * `workspace-write`. No regexes — an allow false positive is a
         * permission incident, which is exactly why this path is deliberately
         * inexpressive.
         */
        allowRules: z<({
            tool?: string | null | undefined;
            operations?: string[] | null | undefined;
            escalationTarget?: string | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<{
            /** Exact tool name the rule applies to (e.g. 'bash'). */
            tool: z<string, string>;
            /**
             * Literal operation prefixes (e.g. 'git status', 'mkdir -p ./dist').
             * The operation is the call's `command` / `operation` / `script`
             * argument field. Empty = any operation (plain asks only; an
             * escalation rule must pin operations).
             */
            operations: z<string[], string[]>;
            /**
             * '' = plain asks only. 'workspace-write' = this rule may also grant
             * escalation asks whose requested target is EXACTLY workspace-write.
             * danger-full-access is structurally ungrantable here.
             */
            escalationTarget: z<string, string>;
        }>[]>;
        maxInputChars: z<number, number>;
        /** true = reviewer errors resolve to 'unavailable' (fail closed, neutral for the breaker); false = delegate to the next answerer (human). */
        denyOnReviewerError: z<boolean, boolean>;
        /**
         * Structured evidence for the reviewer: recent human prompts (trusted
         * authorization, seq-tagged) plus untrusted execution context (assistant
         * text, tool calls, and tool-result facts). Reasoning blocks and
         * plugin-injected context are never included. The evidence only ever
         * gets trimmed — it never causes a denial.
         */
        context: z<Schemastery.ObjectS<{
            enabled: z<boolean, boolean>;
            maxMessages: z<number, number>;
            maxChars: z<number, number>;
            /**
             * false (default): tool results reach the reviewer only as distilled
             * facts (output length + sha256), never raw text — raw tool output is
             * the main prompt-injection surface. true (debug/enhanced mode) also
             * includes capped raw result text.
             */
            rawToolResults: z<boolean, boolean>;
        }>, Schemastery.ObjectT<{
            enabled: z<boolean, boolean>;
            maxMessages: z<number, number>;
            maxChars: z<number, number>;
            /**
             * false (default): tool results reach the reviewer only as distilled
             * facts (output length + sha256), never raw text — raw tool output is
             * the main prompt-injection surface. true (debug/enhanced mode) also
             * includes capped raw result text.
             */
            rawToolResults: z<boolean, boolean>;
        }>>;
    }>>;
    breaker: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        consecutiveDenyLimit: z<number, number>;
        windowSize: z<number, number>;
        windowDenyLimit: z<number, number>;
        action: z<"cancel" | "inject" | "off", "cancel" | "inject" | "off">;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        consecutiveDenyLimit: z<number, number>;
        windowSize: z<number, number>;
        windowDenyLimit: z<number, number>;
        action: z<"cancel" | "inject" | "off", "cancel" | "inject" | "off">;
    }>>;
    audit: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        path: z<string, string>;
        includeToolInput: z<boolean, boolean>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        path: z<string, string>;
        includeToolInput: z<boolean, boolean>;
    }>>;
}>>;
/** The defaults-resolved configuration shape (what cfg() returns). */
export interface ResolvedConfig {
    enabled: boolean;
    reviewer: {
        baseURL: string;
        model: string;
        apiKey: string;
        apiKeyEnv: string;
        apiKeyFile: string;
        timeoutMs: number;
        maxTokens: number;
        thinking: 'default' | 'off';
        extraSystemPrompt: string;
        factFinding: {
            enabled: boolean;
            maxRounds: number;
            maxFacts: number;
            content: {
                enabled: boolean;
                maxBytes: number;
            };
        };
    };
    policy: {
        tools: string[];
        allowRules: {
            tool: string;
            operations: string[];
            escalationTarget: string;
        }[];
        maxInputChars: number;
        denyOnReviewerError: boolean;
        context: {
            enabled: boolean;
            maxMessages: number;
            maxChars: number;
            rawToolResults: boolean;
        };
    };
    breaker: {
        enabled: boolean;
        consecutiveDenyLimit: number;
        windowSize: number;
        windowDenyLimit: number;
        action: 'cancel' | 'inject' | 'off';
    };
    audit: {
        enabled: boolean;
        path: string;
        includeToolInput: boolean;
    };
}
