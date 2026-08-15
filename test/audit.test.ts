import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createAuditor } from '../src/audit.ts'
import { Config } from '../src/config.ts'
import { check, NL, report } from './helpers.ts'

const dir = mkdtempSync(path.join(tmpdir(), 'ar-audit-contract-'))
const file = path.join(dir, 'audit.jsonl')
const warnings: string[] = []
let cfg = Config({ audit: { path: file, includeToolInput: false } })
const auditor = createAuditor({
  cfg: () => cfg,
  log: {
    warn: (...args: unknown[]) => warnings.push(args.map(String).join(' ')),
    error: () => {},
    info: () => {},
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

await auditor.record({ toolName: 'bash', callId: 'audit-1' }, undefined, { id: 'session-1', cwd: '/workspace/project' }, entry)
let rows = readFileSync(file, 'utf8').trim().split(NL).map((line) => JSON.parse(line))
check(
  'audit defaults to hash-only decision record',
  rows.length === 1 && rows[0].inputSha256 === entry.inputHash && !('toolInput' in rows[0]),
  true,
)

cfg = Config({ audit: { path: file, includeToolInput: true } })
await auditor.record({ toolName: 'bash', callId: 'audit-2' }, undefined, { id: 'session-1', cwd: '/workspace/project' }, entry)
rows = readFileSync(file, 'utf8').trim().split(NL).map((line) => JSON.parse(line))
check('audit raw tool input requires explicit opt-in', rows[1]?.toolInput, toolCall)
check('audit writes emitted no warning', warnings.length, 0)

rmSync(dir, { recursive: true, force: true })
report()
