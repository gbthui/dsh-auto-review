import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createAuditor } from '../../src/audit.ts'
import { Config } from '../../src/config.ts'
import { check, NL, report } from '../helpers.ts'

// Tool arguments are hashed unless includeToolInput is enabled.
{
  const dir = mkdtempSync(path.join(tmpdir(), 'ar-audit-record-'))
  const file = path.join(dir, 'audit.jsonl')
  const warnings: string[] = []
  let cfg = Config({ audit: { path: file, includeToolInput: false } })
  const auditor = createAuditor({
    cfg: () => cfg,
    log: {
      warn: (...args: unknown[]) => warnings.push(args.map(String).join(' ')),
      error: () => {},
    },
  })

  const toolCall = { name: 'bash', arguments: '{"command":"echo private-input"}' }
  const entry = {
    decision: 'allow' as const,
    risk: 'low',
    reason: 'test decision',
    source: 'reviewer',
    inputHash: 'a'.repeat(64),
    durationMs: 12,
    workspaceRoot: '/workspace/project',
    sandboxMode: 'workspace-write',
    toolCall,
  }
  const request = (callId: string) => ({ toolName: 'bash', callId }) as Parameters<typeof auditor.record>[0]

  await auditor.record(request('audit-1'), undefined, { id: 'session-1', cwd: '/workspace/project' }, entry)
  let rows = readFileSync(file, 'utf8').trim().split(NL).map((line) => JSON.parse(line))
  check(
    'audit defaults to hash-only decision record',
    rows.length === 1 && rows[0].inputSha256 === entry.inputHash && !('toolInput' in rows[0]),
    true,
  )

  cfg = Config({ audit: { path: file, includeToolInput: true } })
  await auditor.record(request('audit-2'), undefined, { id: 'session-1', cwd: '/workspace/project' }, entry)
  rows = readFileSync(file, 'utf8').trim().split(NL).map((line) => JSON.parse(line))
  check('audit raw tool input requires explicit opt-in', rows[1]?.toolInput, toolCall)
  check('audit writes emitted no warning', warnings.length, 0)

  rmSync(dir, { recursive: true, force: true })
}

// audit.enabled=false performs no write.
{
  const dir = mkdtempSync(path.join(tmpdir(), 'ar-audit-disabled-'))
  const target = path.join(dir, 'disabled.jsonl')
  const cfg = Config({ audit: { enabled: false, path: target } })
  const auditor = createAuditor({ cfg: () => cfg as never, log: { warn: () => {}, error: () => {} } })
  await auditor.record({ toolName: 'bash' } as never, undefined, undefined, {
    decision: 'deny', risk: 'low', reason: 'x', source: 'test', inputHash: 'a'.repeat(64), durationMs: 0, workspaceRoot: '', sandboxMode: '', toolCall: null,
  })
  check('disabled audit emits no file', existsSync(target), false)
  rmSync(dir, { recursive: true, force: true })
}

// Audit I/O errors are logged and do not escape record().
{
  const dir = mkdtempSync(path.join(tmpdir(), 'ar-audit-write-failure-'))
  const warnings: string[] = []
  const cfg = Config({ audit: { path: dir } })
  const auditor = createAuditor({ cfg: () => cfg as never, log: { warn: (message: unknown) => warnings.push(String(message)), error: () => {} } })
  await auditor.record({ toolName: 'bash' } as never, undefined, undefined, {
    decision: 'deny', risk: 'low', reason: 'x', source: 'test', inputHash: 'b'.repeat(64), durationMs: 0, workspaceRoot: '', sandboxMode: '', toolCall: null,
  })
  check('audit write failure logs warning and does not throw', warnings.some((message) => message.includes('audit write failed')), true)
  rmSync(dir, { recursive: true, force: true })
}

report()
