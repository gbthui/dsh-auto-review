import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { ResolvedConfig } from './config.ts'
import type { ToolCallRecord } from './evidence.ts'
import { expandHome, type LoggerLike } from './util.ts'

export interface AuditEntry {
  decision: 'allow' | 'deny'
  risk: string
  reason: string
  source: string
  inputHash: string
  durationMs: number
  workspaceRoot: string
  sandboxMode: string
  toolCall: ToolCallRecord | null
}

export interface Auditor {
  /** One JSON line per review decision; tool input as sha256 unless includeToolInput. */
  record(req: Pick<ApprovalRequest, 'toolName' | 'callId'>, agent: Agent | undefined, session: { id?: string; cwd?: string } | undefined, entry: AuditEntry): Promise<void>
}

/** The audit sink: every decision becomes one JSON line in the audit file. */
export function createAuditor(deps: { cfg: () => ResolvedConfig; log: LoggerLike }): Auditor {
  const { cfg, log } = deps
  const writeLine = async (line: Record<string, unknown>): Promise<void> => {
    const c = cfg()
    if (!c.audit.enabled) return
    try {
      const file = expandHome(c.audit.path)
      await mkdir(path.dirname(file), { recursive: true })
      await appendFile(file, JSON.stringify(line) + '\n', 'utf8')
    } catch (error) {
      log.warn('audit write failed: %s', String((error as Error)?.message ?? error))
    }
  }

  const record: Auditor['record'] = async (req, agent, session, entry) => {
    const c = cfg()
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
    })
  }

  return { record }
}
