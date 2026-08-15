import { readFile } from 'node:fs/promises';
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
import { NS } from './meta.js';
import { expandHome } from './util.js';
import { DEFAULT_REVIEWER_POLICY } from './policy.js';
import { FACT_TOOLS } from './facts.js';
/**
 * Parse the reviewer free-form JSON verdict (tolerates code fences and
 * surrounding prose). Throws on anything unusable — callers fail closed.
 */
export function parseVerdict(text) {
    let body = String(text ?? '').trim();
    const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence)
        body = (fence[1] ?? '').trim();
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start === -1 || end <= start)
        throw new Error('reviewer did not return a JSON object');
    const parsed = JSON.parse(body.slice(start, end + 1));
    if (parsed.decision !== 'allow' && parsed.decision !== 'deny') {
        throw new Error('reviewer returned an invalid decision: ' + JSON.stringify(parsed.decision));
    }
    const risk = parsed.risk;
    if (risk !== 'low' && risk !== 'medium' && risk !== 'high' && risk !== 'critical') {
        throw new Error('reviewer returned an invalid risk: ' + JSON.stringify(risk));
    }
    // Deterministic invariant: a critical-risk action can never be allowed.
    const decision = risk === 'critical' ? 'deny' : parsed.decision;
    const normalizedNote = decision !== parsed.decision ? ' [normalized: critical risk cannot be allowed]' : '';
    return {
        decision,
        risk,
        reason: (typeof parsed.reason === 'string' ? parsed.reason : '') + normalizedNote,
    };
}
/**
 * Parse a reviewer reply: either a final verdict, or a bounded fact request.
 * Unknown fact tools or malformed queries throw — callers fail closed.
 */
export function parseReviewerReply(text) {
    let body = String(text ?? '').trim();
    const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence)
        body = (fence[1] ?? '').trim();
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start === -1 || end <= start)
        throw new Error('reviewer did not return a JSON object');
    const parsed = JSON.parse(body.slice(start, end + 1));
    if (parsed.decision === 'need_fact') {
        const req = parsed.fact_request;
        if (!req || !Array.isArray(req.queries) || req.queries.length === 0)
            throw new Error('need_fact without valid queries');
        const queries = [];
        for (const raw of req.queries) {
            const tool = typeof raw?.tool === 'string' ? raw.tool : '';
            if (!FACT_TOOLS.has(tool))
                throw new Error('unknown fact tool: ' + JSON.stringify(tool));
            if (tool === 'inspect_git_remote') {
                queries.push({ tool, remote: typeof raw.remote === 'string' && raw.remote.trim() ? raw.remote : 'origin' });
            }
            else if (tool === 'inspect_git_status') {
                queries.push({ tool });
            }
            else if (tool === 'inspect_text_file' && typeof raw?.path === 'string' && raw.path.trim()) {
                queries.push({ tool, path: raw.path });
            }
            else if (typeof raw?.path === 'string' && raw.path.trim()) {
                queries.push({ tool, path: raw.path });
            }
            else {
                throw new Error('fact tool ' + tool + ' requires a path');
            }
        }
        return { kind: 'fact-request', queries };
    }
    return { kind: 'verdict', verdict: parseVerdict(text) };
}
export async function resolveApiKey(reviewer) {
    if (reviewer.apiKey && reviewer.apiKey.trim())
        return reviewer.apiKey.trim();
    if (reviewer.apiKeyEnv) {
        const value = process.env[reviewer.apiKeyEnv];
        if (value && value.trim())
            return value.trim();
    }
    if (reviewer.apiKeyFile) {
        try {
            const content = await readFile(expandHome(reviewer.apiKeyFile), 'utf8');
            const line = content.split('\n')
                .map((l) => l.trim())
                .find((l) => l && !l.startsWith('#') && /^[A-Za-z_][A-Za-z0-9_]*=/.test(l));
            if (line) {
                const value = line.slice(line.indexOf('=') + 1).trim();
                if (value)
                    return value;
            }
        }
        catch {
            /* fall through to null */
        }
    }
    return null;
}
export async function callReviewer(reviewer, prompt, signal) {
    const key = await resolveApiKey(reviewer);
    if (!key)
        throw new Error('no reviewer API key available (check apiKey / apiKeyEnv / apiKeyFile)');
    const url = String(reviewer.baseURL ?? '').replace(/\/+$/, '') + '/chat/completions';
    const signals = [AbortSignal.timeout(reviewer.timeoutMs ?? 24000)];
    if (signal)
        signals.push(signal);
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({
            model: reviewer.model ?? '',
            messages: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user },
            ],
            max_tokens: reviewer.maxTokens ?? 1024,
            ...(reviewer.thinking === 'off' ? { thinking: { type: 'disabled' } } : {}),
        }),
        signal: AbortSignal.any(signals),
    });
    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error('reviewer HTTP ' + res.status + ': ' + detail.slice(0, 200));
    }
    const data = (await res.json());
    const message = data?.choices?.[0]?.message;
    // The verdict must be the final answer. reasoning_content is the model's
    // chain-of-thought draft — it is never parsed as an authorization.
    const content = typeof message?.content === 'string' && message.content.trim() ? message.content : null;
    if (!content)
        throw new Error('reviewer returned empty content');
    return content;
}
/**
 * Review with the calling session's current model: the harness's own LLM
 * runtime, routed to the exact provider/model the agent uses. Credentials
 * come from the harness (credentials seam / provider env), not from this
 * plugin. Used when no explicit reviewer endpoint is configured.
 */
export async function reviewWithSessionModel(ctx, agent, reviewer, prompt, signal) {
    const llm = ctx.get('llm');
    if (!llm)
        throw new Error('no llm service available for session-model review');
    const provider = agent?.options?.provider;
    const model = agent?.options?.model;
    if (!provider || !model)
        throw new Error('the session has no provider/model to review with');
    const assembler = new BlockAssembler();
    const signals = [AbortSignal.timeout(reviewer.timeoutMs ?? 24000)];
    if (signal)
        signals.push(signal);
    const stream = llm.stream({
        provider,
        model,
        messages: [createUserMessage({
                content: [{ type: 'text', text: prompt.user }],
                source: { kind: 'plugin', plugin: NS },
            })],
        system: prompt.system,
        maxTokens: reviewer.maxTokens ?? 1024,
        ...(reviewer.thinking === 'off' && provider === 'deepseek-official' ? { reasoningEffort: 'off' } : {}),
        signal: AbortSignal.any(signals),
    });
    for await (const chunk of stream) {
        assembler.push(chunk);
    }
    // The verdict must be the final answer; reasoning blocks are never parsed.
    const text = assembler.blocks()
        .filter((block) => block.type === 'text')
        .map((block) => String(block.text ?? ''))
        .join('');
    if (!text.trim())
        throw new Error('session-model reviewer returned empty content');
    return text;
}
export function buildPrompt(req, toolCall, facts, evidence, override = null, factObservations = []) {
    const system = DEFAULT_REVIEWER_POLICY;
    const user = [
        'Review this pending permission request and reply with JSON only.',
        JSON.stringify({
            tool: req.toolName,
            workspaceRoot: facts.workspaceRoot ?? '',
            sandboxMode: facts.sandboxMode ?? '',
            agentReason: req.reason ?? '',
            toolCall: toolCall ?? null,
            evidence: {
                latest_user_request: evidence.latestUserRequest,
                prior_user_requests: evidence.priorUserRequests,
                untrusted_execution_context: evidence.untrustedExecution,
            },
            post_denial_user_approval: override,
            fact_observations: factObservations,
        }, null, 2),
    ].join('\n\n');
    return { system, user };
}
