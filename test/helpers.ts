/**
 * Shared test scaffolding for units.test.ts and pipeline.test.ts:
 * the tiny check runner, the mock-context pipeline harness, and the
 * shared audit temp file.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply as AutoReview } from '../src/index.ts'

export const BQ = String.fromCharCode(96)
export const NL = String.fromCharCode(10)
export const SYNTHETIC_WORKSPACE = '/workspace/project'

export let failures = 0
export function addFailure(): void {
  failures++
}
export function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    addFailure()
    console.error('FAIL ' + label)
    console.error('  expected: ' + JSON.stringify(expected))
    console.error('  actual:   ' + JSON.stringify(actual))
  } else {
    console.log('ok   ' + label)
  }
}

/** Print the final verdict and exit — call once at the end of each test file. */
export function report(): never {
  console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED')
  process.exit(failures === 0 ? 0 : 1)
}

/** Pipeline harness: a mock context whose approval/request listener is captured. */
export function makeHarness(rowConfig: unknown): { injected: any[]; cancelled: any[]; getHandler: () => any; prepend: () => boolean | null } {
  const injected: any[] = []
  const cancelled: any[] = []
  let handler: any = null
  let prepend: boolean | null = null
  const ctx = {
    logger: () => ({ warn: () => {}, error: () => {}, info: () => {} }),
    get: () => { throw new Error('no service') },
    on: (ev: string, fn: unknown, opt: boolean | null) => {
      if (ev === 'approval/request') { handler = fn; prepend = opt }
    },
  }
  AutoReview(ctx, rowConfig)
  return { injected, cancelled, getHandler: () => handler, prepend: () => prepend }
}

/** Minimal agent mock for pipeline tests. */
export function makeAgent(): any {
  return {
    id: 'agent-1',
    options: { provider: 'test-provider', model: 'test-model' },
    session: { id: 'session-1', cwd: SYNTHETIC_WORKSPACE, events: [] },
    inject: () => {},
    cancel: () => {},
  }
}

/**
 * Pipeline harness with a mock session-model reviewer: each ask pops the
 * next queue entry — a verdict JSON string, or 'error' to throw as an
 * infra failure (which the handler resolves to 'unavailable').
 */
export function makeLlmHarness(rowConfig: unknown, verdictQueue: string[]): { getHandler: () => any; injected: any[]; cancelled: any[] } {
  const injected: any[] = []
  const cancelled: any[] = []
  let handler: any = null
  const ctx = {
    logger: () => ({ warn: () => {}, error: () => {}, info: () => {} }),
    get: (n: string) => {
      if (n === 'llm') {
        return {
          stream: async function* () {
            const next = verdictQueue.shift() ?? '{"decision":"deny","risk":"high","reason":"mock verdict"}'
            if (next === 'error') throw new Error('mock reviewer down')
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'text-delta', index: 0, text: next }
            yield { type: 'block-end', index: 0, block: { type: 'text', text: next } }
            yield { type: 'finish', reason: 'stop' }
          },
        }
      }
      throw new Error('no service: ' + n)
    },
    on: (ev: string, fn: unknown) => { if (ev === 'approval/request') handler = fn },
  }
  AutoReview(ctx, rowConfig)
  return { getHandler: () => handler, injected, cancelled }
}

const auditDir = mkdtempSync(path.join(tmpdir(), 'ar-audit-'))
export { auditDir }
export const auditFile = path.join(auditDir, 'audit.jsonl')
export function readAudit(): any[] {
  return readFileSync(auditFile, 'utf8').trim().split(NL).filter(Boolean).map((l) => JSON.parse(l))
}
export function cleanupAudit(): void {
  rmSync(auditDir, { recursive: true, force: true })
}
