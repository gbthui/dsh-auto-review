import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  apply as AutoReview,
  Config,
  createAuditor,
  validateConfig,
} from '../src/index.ts'
import { auditFile, check, makeAgent, report } from './helpers.ts'

function reviewerStream(queue: string[], onStart?: () => void) {
  return async function* () {
    onStart?.()
    const next = queue.shift() ?? '{"decision":"deny","risk":"medium","reason":"default deny"}'
    if (next === '__throw__') throw new Error('mock reviewer transport failed')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: next }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: next } }
    yield { type: 'finish', reason: 'stop' }
  }
}

// ---------- configuration validation and settings fallback ----------
{
  const invalidTool = validateConfig(Config({ policy: { allowRules: [{}] } }) as never)
  check('empty allow-rule tool is rejected', String(invalidTool).includes('tool must be a non-empty string'), true)
}

{
  let handler: any = null
  const warnings: string[] = []
  const ctx = {
    logger: () => ({ warn: (m: unknown) => warnings.push(String(m)), error: () => {} }),
    get: (name: string) => {
      if (name === 'settings') return { register: () => { throw new Error('settings offline') } }
      throw new Error('no service: ' + name)
    },
    on: (event: string, fn: unknown) => { if (event === 'approval/request') handler = fn },
  }
  AutoReview(ctx as never, {
    policy: { allowRules: [{ tool: 'bash', operations: ['ls'], escalationTarget: '' }] },
    audit: { enabled: false },
  })
  const agent = makeAgent()
  agent.session.events = [{ type: 'tool/call', data: { callId: 'settings-reg-fail', name: 'bash', arguments: '{"command":"ls"}' } }]
  const out = await handler({ agent, toolName: 'bash', callId: 'settings-reg-fail', reason: 'x' }, async () => 'DELEGATED')
  check('settings registration failure falls back to valid row config', out, 'allowed-once')
  check('settings registration failure is logged', warnings.some((m) => m.includes('settings registration failed')), true)
}

{
  let handler: any = null
  const warnings: string[] = []
  const ctx = {
    logger: () => ({ warn: (m: unknown) => warnings.push(String(m)), error: () => {} }),
    get: (name: string) => {
      if (name === 'settings') return {
        register: () => ({
          get: () => { throw new Error('settings read failed') },
          update: async () => {},
        }),
      }
      throw new Error('no service: ' + name)
    },
    on: (event: string, fn: unknown) => { if (event === 'approval/request') handler = fn },
  }
  AutoReview(ctx as never, {})
  const out = await handler({ agent: makeAgent(), toolName: 'bash', reason: 'x' }, async () => 'DELEGATED')
  check('settings read failure before any good config delegates safely', out, 'DELEGATED')
  check('settings read failure is logged once', warnings.filter((m) => m.includes('settings read failed')).length, 1)
}

{
  let handler: any = null
  let reads = 0
  const warnings: string[] = []
  const good = Config({
    policy: { allowRules: [{ tool: 'bash', operations: ['ls'], escalationTarget: '' }] },
    audit: { path: auditFile },
  })
  const ctx = {
    logger: () => ({ warn: (m: unknown) => warnings.push(String(m)), error: () => {} }),
    get: (name: string) => {
      if (name === 'settings') return {
        register: () => ({
          get: () => {
            reads++
            if (reads === 1) return good
            throw new Error('transient settings read failure')
          },
          update: async () => {},
        }),
      }
      throw new Error('no service: ' + name)
    },
    on: (event: string, fn: unknown) => { if (event === 'approval/request') handler = fn },
  }
  AutoReview(ctx as never, {})
  const agent = makeAgent()
  agent.session.events = [{ type: 'tool/call', data: { callId: 'last-good', name: 'bash', arguments: '{"command":"ls"}' } }]
  const out = await handler({ agent, toolName: 'bash', callId: 'last-good', reason: 'x' }, async () => 'DELEGATED')
  check('settings read failure retains last known-good during audit', out, 'allowed-once')
  check('last-known-good settings fallback logs warning', warnings.some((m) => m.includes('settings read failed')), true)
}

{
  let handler: any = null
  const errors: string[] = []
  const ctx = {
    logger: () => ({ warn: () => {}, error: (m: unknown) => errors.push(String(m)) }),
    get: () => { throw new Error('no service') },
    on: (event: string, fn: unknown) => { if (event === 'approval/request') handler = fn },
  }
  AutoReview(ctx as never, { enabled: 'yes' })
  const out = await handler({ agent: makeAgent(), toolName: 'bash', reason: 'x' }, async () => 'DELEGATED')
  check('structurally invalid row config refuses to arm', out, 'DELEGATED')
  check('invalid row config parse failure is logged', errors.some((m) => m.includes('refusing to arm')), true)
}

// ---------- optional sandbox facts and mid-review cancellation ----------
{
  let handler: any = null
  let prompt = ''
  const ctx = {
    logger: () => ({ warn: () => {}, error: () => {} }),
    get: (name: string) => {
      if (name === 'sandboxPolicy') return { resolve: () => { throw new Error('sandbox policy unavailable') } }
      if (name === 'llm') return {
        stream: async function* (options: any) {
          prompt = options.messages[0].content[0].text
          const text = '{"decision":"allow","risk":"low","reason":"ok"}'
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: 'stop' }
        },
      }
      throw new Error('no service: ' + name)
    },
    on: (event: string, fn: unknown) => { if (event === 'approval/request') handler = fn },
  }
  AutoReview(ctx as never, { audit: { enabled: false } })
  const agent = makeAgent()
  agent.session.cwd = '/workspace/session-fallback'
  agent.session.events = [{ type: 'tool/call', data: { callId: 'sandbox-fail', name: 'bash', arguments: '{"command":"ls"}' } }]
  const out = await handler({ agent, toolName: 'bash', callId: 'sandbox-fail', reason: 'x' }, async () => 'DELEGATED')
  check('sandbox policy failure falls back to session cwd', out, 'allowed-once')
  check('sandbox fallback workspace reaches reviewer', prompt.includes('/workspace/session-fallback'), true)
}

{
  let handler: any = null
  const controller = new AbortController()
  const ctx = {
    logger: () => ({ warn: () => {}, error: () => {} }),
    get: (name: string) => {
      if (name === 'llm') return { stream: reviewerStream(['__throw__'], () => controller.abort()) }
      throw new Error('no service: ' + name)
    },
    on: (event: string, fn: unknown) => { if (event === 'approval/request') handler = fn },
  }
  AutoReview(ctx as never, { audit: { enabled: false } })
  const agent = makeAgent()
  agent.session.events = [{ type: 'tool/call', data: { callId: 'abort-mid-review', name: 'bash', arguments: '{"command":"ls"}' } }]
  const out = await handler({ agent, toolName: 'bash', callId: 'abort-mid-review', reason: 'x', signal: controller.signal }, async () => 'DELEGATED')
  check('abort during reviewer failure returns cancelled', out, 'cancelled')
}

// ---------- breaker action variants and host callback failures ----------
async function driveDenials(action: 'cancel' | 'inject' | 'off', options?: { injectThrows?: boolean; cancelThrows?: boolean }) {
  let handler: any = null
  const warnings: string[] = []
  const injected: unknown[] = []
  const cancelled: unknown[] = []
  const queue = Array(3).fill('{"decision":"deny","risk":"medium","reason":"not authorized"}')
  const ctx = {
    logger: () => ({ warn: (m: unknown) => warnings.push(String(m)), error: () => {} }),
    get: (name: string) => {
      if (name === 'llm') return { stream: reviewerStream(queue) }
      throw new Error('no service: ' + name)
    },
    on: (event: string, fn: unknown) => { if (event === 'approval/request') handler = fn },
  }
  AutoReview(ctx as never, { breaker: { action }, audit: { enabled: false } })
  const agent = makeAgent()
  agent.inject = (message: unknown) => {
    if (options?.injectThrows) throw new Error('inject unavailable')
    injected.push(message)
  }
  agent.cancel = (cause: unknown) => {
    if (options?.cancelThrows) throw new Error('cancel unavailable')
    cancelled.push(cause)
  }
  for (let i = 0; i < 3; i++) {
    agent.session.events = [{ type: 'tool/call', data: { callId: `${action}-${i}`, name: 'bash', arguments: '{"command":"ls"}' } }]
    await handler({ agent, toolName: 'bash', callId: `${action}-${i}`, reason: 'x' }, async () => 'DELEGATED')
  }
  return { warnings, injected, cancelled }
}

{
  const result = await driveDenials('off')
  check('breaker off performs no trip action', result.injected.length === 0 && result.cancelled.length === 0, true)
}

{
  const result = await driveDenials('inject')
  check('breaker inject action explains without cancelling', result.injected.length === 1 && result.cancelled.length === 0, true)
}

{
  const result = await driveDenials('cancel', { injectThrows: true, cancelThrows: true })
  check('breaker callback failures never escape answerer', result.cancelled.length, 0)
  check('breaker inject failure is logged', result.warnings.some((m) => m.includes('inject failed')), true)
  check('breaker cancel failure is logged', result.warnings.some((m) => m.includes('cancel failed')), true)
}

// ---------- audit sink disabled and write-failure behavior ----------
{
  const dir = mkdtempSync(path.join(tmpdir(), 'ar-audit-disabled-'))
  const target = path.join(dir, 'disabled.jsonl')
  const cfg = Config({ audit: { enabled: false, path: target } })
  const auditor = createAuditor({ cfg: () => cfg as never, log: { warn: () => {}, error: () => {} } })
  await auditor.record({ toolName: 'bash' } as never, undefined, undefined, {
    decision: 'deny', risk: 'low', reason: 'x', source: 'test', inputHash: 'a'.repeat(64), durationMs: 0, workspaceRoot: '', sandboxMode: '', toolCall: null,
  })
  check('disabled audit emits no file', existsSync(target), false)
}

{
  const dir = mkdtempSync(path.join(tmpdir(), 'ar-audit-fail-'))
  const warnings: string[] = []
  const cfg = Config({ audit: { path: dir } })
  const auditor = createAuditor({ cfg: () => cfg as never, log: { warn: (m: unknown) => warnings.push(String(m)), error: () => {} } })
  await auditor.record({ toolName: 'bash' } as never, undefined, undefined, {
    decision: 'deny', risk: 'low', reason: 'x', source: 'test', inputHash: 'b'.repeat(64), durationMs: 0, workspaceRoot: '', sandboxMode: '', toolCall: null,
  })
  check('audit write failure is contained and logged', warnings.some((m) => m.includes('audit write failed')), true)
}

report()
