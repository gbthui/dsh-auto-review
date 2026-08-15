import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expandHome } from './util.js';
/** The audit sink: every decision becomes one JSON line in the audit file. */
export function createAuditor(deps) {
    const { cfg, log } = deps;
    const writeLine = async (line) => {
        const c = cfg();
        if (!c.audit.enabled)
            return;
        try {
            const file = expandHome(c.audit.path);
            await mkdir(path.dirname(file), { recursive: true });
            await appendFile(file, JSON.stringify(line) + '\n', 'utf8');
        }
        catch (error) {
            log.warn('audit write failed: %s', String(error?.message ?? error));
        }
    };
    const record = async (req, agent, session, entry) => {
        const c = cfg();
        await writeLine({
            timestamp: new Date().toISOString(),
            session: session?.id ?? null,
            toolName: req.toolName,
            callId: req.callId ?? null,
            workspaceRoot: entry.workspaceRoot,
            sandboxMode: entry.sandboxMode,
            decision: entry.decision,
            risk: entry.risk,
            reason: entry.reason,
            source: entry.source,
            durationMs: entry.durationMs,
            inputSha256: entry.inputHash,
            ...(c.audit.includeToolInput ? { toolInput: entry.toolCall ?? null } : {}),
        });
    };
    return { record };
}
