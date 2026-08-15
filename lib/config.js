import z from '@deepseek-ai/schemastery';
export const Config = z.object({
    enabled: z.boolean().default(true),
    reviewer: z.object({
        /** Empty baseURL = review with the session's current model via ctx.llm. */
        baseURL: z.string().default(''),
        model: z.string().default(''),
        apiKey: z.string().role('secret').default(''),
        apiKeyEnv: z.string().default(''),
        apiKeyFile: z.string().default(''),
        timeoutMs: z.number().default(24000),
        /** Verdict JSON is ~100-300 tokens; the cap only guards runaway output. */
        maxTokens: z.number().default(1024),
        /**
         * Request-side reasoning control. The verdict ALWAYS comes from the
         * final answer — chain-of-thought output is never parsed as an
         * authorization. 'off' disables reasoning on the request side so the
         * final answer lands deterministically (endpoint path sends DeepSeek's
         * `thinking:{type:disabled}`; session path maps to the adapter's
         * 'off' effort on `deepseek-official`).
         */
        thinking: z.union(['default', 'off']).default('default'),
        extraSystemPrompt: z.string().default(''),
        /**
         * Bounded read-only fact finding: the reviewer may ask for a few LOCAL
         * metadata facts (paths, directory stats, git remote/status) before its
         * final verdict. Fixed semantic tools only — no shell, no network, no
         * escalation, never a new approval ask. File CONTENT is never exposed.
         */
        factFinding: z.object({
            enabled: z.boolean().default(true),
            maxRounds: z.number().default(2),
            maxFacts: z.number().default(3),
            /**
             * File-CONTENT inspection (inspect_text_file). OFF by default.
             * When an external reviewer.baseURL is configured, enabling this
             * explicitly allows bounded workspace content to be sent there.
             * Workspace-only, binary-denied, sensitive-path-denied, capped.
             */
            content: z.object({
                enabled: z.boolean().default(false),
                maxBytes: z.number().default(4096),
            }).default({ enabled: false, maxBytes: 4096 }),
        }).default({ enabled: true, maxRounds: 2, maxFacts: 3, content: { enabled: false, maxBytes: 4096 } }),
    }),
    policy: z.object({
        /** Tool names the reviewer answers for; empty = every approval ask. */
        tools: z.array(z.string()).default([]),
        /**
         * TYPED no-review allow rules. A match grants the pending approval
         * (`allowed-once`) WITHOUT review, so the shape is deliberately
         * inexpressive: exact tool name + literal operation prefixes + (for
         * escalation asks) an explicit target that can never exceed
         * `workspace-write`. No regexes — an allow false positive is a
         * permission incident, which is exactly why this path is deliberately
         * inexpressive.
         */
        allowRules: z.array(z.object({
            /** Exact tool name the rule applies to (e.g. 'bash'). */
            tool: z.string().default(''),
            /**
             * Literal operation prefixes (e.g. 'git status', 'mkdir -p ./dist').
             * The operation is the call's `command` / `operation` / `script`
             * argument field. Empty = any operation (plain asks only; an
             * escalation rule must pin operations).
             */
            operations: z.array(z.string()).default([]),
            /**
             * '' = plain asks only. 'workspace-write' = this rule may also grant
             * escalation asks whose requested target is EXACTLY workspace-write.
             * danger-full-access is structurally ungrantable here.
             */
            escalationTarget: z.string().default(''),
        }).default({ tool: '', operations: [], escalationTarget: '' })).default([]),
        maxInputChars: z.number().default(16000),
        /** true = reviewer errors resolve to 'unavailable' (fail closed, neutral for the breaker); false = delegate to the next answerer (human). */
        denyOnReviewerError: z.boolean().default(true),
        /**
         * Structured evidence for the reviewer: recent human prompts (trusted
         * authorization, seq-tagged) plus untrusted execution context (assistant
         * text, tool calls, and tool-result facts). Reasoning blocks and
         * plugin-injected context are never included. The evidence only ever
         * gets trimmed — it never causes a denial.
         */
        context: z.object({
            enabled: z.boolean().default(true),
            maxMessages: z.number().default(10),
            maxChars: z.number().default(6000),
            /**
             * false (default): tool results reach the reviewer only as distilled
             * facts (output length + sha256), never raw text — raw tool output is
             * the main prompt-injection surface. true (debug/enhanced mode) also
             * includes capped raw result text.
             */
            rawToolResults: z.boolean().default(false),
        }).default({ enabled: true, maxMessages: 10, maxChars: 6000, rawToolResults: false }),
    }),
    breaker: z.object({
        enabled: z.boolean().default(true),
        consecutiveDenyLimit: z.number().default(3),
        windowSize: z.number().default(50),
        windowDenyLimit: z.number().default(10),
        action: z.union(['cancel', 'inject', 'off']).default('cancel'),
    }),
    audit: z.object({
        enabled: z.boolean().default(true),
        path: z.string().default('~/.dsh/auto-review-audit.jsonl'),
        includeToolInput: z.boolean().default(false),
    }),
});
