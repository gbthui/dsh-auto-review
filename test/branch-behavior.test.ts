import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  apply as AutoReview,
  Breaker,
  Config,
  callReviewer,
  currentTurn,
  executeFacts,
  matchAllowRule,
  parseReviewerReply,
  parseVerdict,
  resolveApiKey,
  reviewWithSessionModel,
  sanitizeGitUrl,
} from '../src/index.ts'
import { auditFile, check, makeAgent, NL, report } from './helpers.ts'

// ---------- typed allow-rule control flow ----------
check('allow matcher: empty rules miss', matchAllowRule([], { name: 'bash', arguments: '{"command":"ls"}' }), null)
check('allow matcher: wrong tool misses', matchAllowRule([
  { tool: 'other', operations: [], escalationTarget: '' },
], { name: 'bash', arguments: '{"command":"ls"}' }), null)
check('allow matcher: plain empty operations matches any structured op', Boolean(matchAllowRule([
  { tool: 'bash', operations: [], escalationTarget: '' },
], { name: 'bash', arguments: '{"operation":"rotate"}' })), true)
check('allow matcher: operation field matches prefix', Boolean(matchAllowRule([
  { tool: 'task', operations: ['rotate'], escalationTarget: '' },
], { name: 'task', arguments: '{"operation":"rotate logs"}' })), true)
check('allow matcher: script field matches prefix', Boolean(matchAllowRule([
  { tool: 'runner', operations: ['build'], escalationTarget: '' },
], { name: 'runner', arguments: '{"script":"build production"}' })), true)
check('allow matcher: escalation-only rule misses plain ask', matchAllowRule([
  { tool: 'bash', operations: ['rsync'], escalationTarget: 'workspace-write' },
], { name: 'bash', arguments: '{"command":"rsync ./a ./b"}' }), null)
check('allow matcher: escalation target mismatch misses', matchAllowRule([
  { tool: 'bash', operations: ['rsync'], escalationTarget: 'workspace-write' },
], { name: 'bash', arguments: '{"command":"rsync ./a ./b","sandbox_permissions":"network"}' }), null)
check('allow matcher: escalation without operation misses', matchAllowRule([
  { tool: 'bash', operations: ['rsync'], escalationTarget: 'workspace-write' },
], { name: 'bash', arguments: '{"sandbox_permissions":"workspace-write"}' }), null)

// ---------- reviewer reply and credential fallbacks ----------
check('verdict non-string reason normalizes empty', parseVerdict('{"decision":"allow","risk":"low","reason":12}').reason, '')
const gitOrigin = parseReviewerReply('{"decision":"need_fact","fact_request":{"queries":[{"tool":"inspect_git_remote"}]}}')
check('fact parser defaults git remote to origin', gitOrigin.kind === 'fact-request' ? gitOrigin.queries[0] : null, { tool: 'inspect_git_remote', remote: 'origin' })
const gitNamed = parseReviewerReply('{"decision":"need_fact","fact_request":{"queries":[{"tool":"inspect_git_remote","remote":"upstream"},{"tool":"inspect_git_status"}]}}')
check('fact parser preserves named git remote', gitNamed.kind === 'fact-request' ? gitNamed.queries[0] : null, { tool: 'inspect_git_remote', remote: 'upstream' })
check('fact parser accepts git status without path', gitNamed.kind === 'fact-request' ? gitNamed.queries[1] : null, { tool: 'inspect_git_status' })
let threw = false
try { parseReviewerReply('{"decision":"need_fact","fact_request":{"queries":[{"tool":"inspect_path"}]}}') } catch { threw = true }
check('fact parser rejects missing metadata path', threw, true)

process.env.AR_BRANCH_EMPTY_KEY = '   '
check('resolveApiKey trims direct value', await resolveApiKey({ apiKey: '  direct-key  ' }), 'direct-key')
const keyDir = mkdtempSync(path.join(tmpdir(), 'ar-key-branches-'))
const emptyKeyFile = path.join(keyDir, 'empty.env')
writeFileSync(emptyKeyFile, '# comment only' + NL + 'not-an-assignment' + NL)
check('resolveApiKey empty env falls through to empty file then null', await resolveApiKey({ apiKeyEnv: 'AR_BRANCH_EMPTY_KEY', apiKeyFile: emptyKeyFile }), null)
check('resolveApiKey missing file falls through to null', await resolveApiKey({ apiKeyFile: path.join(keyDir, 'missing.env') }), null)
rmSync(keyDir, { recursive: true, force: true })

// ---------- endpoint transport failures and signal path ----------
{
  let noKeyError = ''
  try { await callReviewer({ baseURL: 'https://example.invalid/v1' }, { system: 's', user: 'u' }) } catch (error) { noKeyError = String((error as Error).message) }
  check('endpoint reviewer without key fails before fetch', noKeyError.includes('no reviewer API key'), true)

  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = (async () => ({ ok: false, status: 503, text: async () => 'temporary outage' })) as unknown as typeof fetch
    let httpError = ''
    try {
      await callReviewer({ baseURL: 'https://example.invalid/v1/', apiKey: 'k' }, { system: 's', user: 'u' }, new AbortController().signal)
    } catch (error) { httpError = String((error as Error).message) }
    check('endpoint reviewer exposes bounded HTTP failure', httpError.includes('reviewer HTTP 503: temporary outage'), true)

    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '  {"decision":"allow","risk":"low","reason":"ok"}  ' } }] }),
    })) as unknown as typeof fetch
    const endpointText = await callReviewer({ baseURL: 'https://example.invalid/v1', apiKey: 'k' }, { system: 's', user: 'u' }, new AbortController().signal)
    check('endpoint reviewer returns final text with caller signal', endpointText.includes('"decision":"allow"'), true)
  } finally {
    globalThis.fetch = originalFetch
  }
}

// ---------- session-model reviewer fallback paths ----------
{
  let err = ''
  try {
    await reviewWithSessionModel({ get: () => undefined }, makeAgent(), {}, { system: 's', user: 'u' })
  } catch (error) { err = String((error as Error).message) }
  check('session reviewer without llm service fails closed', err.includes('no llm service'), true)

  err = ''
  try {
    await reviewWithSessionModel({ get: () => ({ stream: async function* () {} }) }, undefined, {}, { system: 's', user: 'u' })
  } catch (error) { err = String((error as Error).message) }
  check('session reviewer without provider-model fails closed', err.includes('no provider/model'), true)
}

// ---------- read-only fact-tool behavior and failure paths ----------
{
  const root = mkdtempSync(path.join(tmpdir(), 'ar-fact-branches-'))
  const file = path.join(root, 'plain.txt')
  const dir = path.join(root, 'dir')
  const subdir = path.join(dir, 'sub')
  writeFileSync(file, 'hello')
  mkdirSync(subdir, { recursive: true })

  const meta = await executeFacts([
    { tool: 'inspect_directory', path: 'plain.txt' },
    { tool: 'inspect_directory', path: 'dir' },
    { tool: 'inspect_file_metadata', path: 'plain.txt' },
    { tool: 'inspect_text_file', path: 'dir' },
  ], root, { contentEnabled: true, contentMaxBytes: 4096 })
  check('directory fact rejects regular file', String(meta[0].result.error).includes('not a directory'), true)
  check('directory fact reports entry and subdir counts', meta[1].result.entryCount === 1 && meta[1].result.subdirCount === 1, true)
  check('file metadata reports byte size', meta[2].result.kind === 'file' && meta[2].result.size === 5, true)
  check('content fact rejects directory', String(meta[3].result.error).includes('not a regular file'), true)

  const malformed = sanitizeGitUrl('https://user:secret@example.invalid')
  check('git URL fallback redacts credentials', JSON.stringify(malformed).includes('<redacted>'), true)

  if (process.platform !== 'win32') {
    const bin = mkdtempSync(path.join(tmpdir(), 'ar-git-fail-'))
    const fakeGit = path.join(bin, 'git')
    writeFileSync(fakeGit, '#!/bin/sh\nexit 7\n')
    chmodSync(fakeGit, 0o755)
    const oldPath = process.env.PATH
    process.env.PATH = bin + path.delimiter + (oldPath ?? '')
    try {
      const failedGit = await executeFacts([
        { tool: 'inspect_git_remote', remote: 'origin' },
        { tool: 'inspect_git_status' },
      ], root)
      check('git remote fact returns bounded error observation', typeof failedGit[0].result.error === 'string', true)
      check('git status fact returns bounded error observation', typeof failedGit[1].result.error === 'string', true)
    } finally {
      process.env.PATH = oldPath
      rmSync(bin, { recursive: true, force: true })
    }
  }
  rmSync(root, { recursive: true, force: true })
}

// ---------- breaker disabled/reset/window edge behavior ----------
{
  const breaker = new Breaker()
  const disabled = Config({ breaker: { enabled: false } })
  check('currentTurn undefined is zero', currentTurn(undefined), 0)
  check('currentTurn without turn-start is zero', currentTurn([]), 0)
  breaker.note('a', 'deny', disabled, [])
  check('disabled breaker never returns reason', breaker.reason('a', disabled), null)
  breaker.reset('a')
  check('reset breaker removes state', breaker.reason('a', Config({})), null)

  const noWindow = Config({ breaker: { consecutiveDenyLimit: 99, windowSize: 0, windowDenyLimit: 0 } })
  breaker.note('b', 'deny', noWindow, [])
  breaker.note('b', 'deny', noWindow, [])
  check('zero window deny limit disables window trip', breaker.reason('b', noWindow), null)
}

// ---------- answerer filters, aborts, facts-disabled and fact clipping ----------
{
  const makeCtx = (getImpl: (name: string) => unknown) => {
    let handler: any = null
    const ctx = {
      logger: () => ({ warn: () => {}, error: () => {} }),
      get: getImpl,
      on: (event: string, fn: unknown) => { if (event === 'approval/request') handler = fn },
    }
    return { ctx, handler: () => handler }
  }

  {
    const { ctx, handler } = makeCtx(() => { throw new Error('no service') })
    AutoReview(ctx as never, { policy: { tools: ['write_file'] }, audit: { path: auditFile } })
    const agent = makeAgent()
    agent.session.events = [{ type: 'tool/call', data: { callId: 'filter-1', name: 'bash', arguments: '{"command":"ls"}' } }]
    const out = await handler()({ agent, toolName: 'bash', callId: 'filter-1', reason: 'x' }, async () => 'DELEGATED')
    check('tool filter delegates excluded approval asks', out, 'DELEGATED')
  }

  {
    const { ctx, handler } = makeCtx(() => { throw new Error('no service') })
    AutoReview(ctx as never, { audit: { path: auditFile } })
    const agent = makeAgent()
    agent.session.events = [{ type: 'tool/call', data: { callId: 'abort-1', name: 'bash', arguments: '{"command":"ls"}' } }]
    const controller = new AbortController()
    controller.abort()
    const out = await handler()({ agent, toolName: 'bash', callId: 'abort-1', reason: 'x', signal: controller.signal }, async () => 'DELEGATED')
    check('already-aborted approval returns cancelled', out, 'cancelled')
  }

  {
    const replies = ['{"decision":"need_fact","fact_request":{"queries":[{"tool":"inspect_path","path":"x"}]}}']
    const { ctx, handler } = makeCtx((name) => {
      if (name === 'llm') return {
        stream: async function* () {
          const text = replies.shift() ?? '{"decision":"deny","risk":"high","reason":"x"}'
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: 'stop' }
        },
      }
      throw new Error('no service')
    })
    AutoReview(ctx as never, { reviewer: { factFinding: { enabled: false } }, audit: { path: auditFile } })
    const agent = makeAgent()
    agent.session.events = [{ type: 'tool/call', data: { callId: 'facts-off', name: 'bash', arguments: '{"command":"ls"}' } }]
    const out = await handler()({ agent, toolName: 'bash', callId: 'facts-off', reason: 'x' }, async () => 'DELEGATED')
    check('fact request with fact finding disabled fails closed', out, 'unavailable')
  }

  {
    const prompts: string[] = []
    const replies = [
      '{"decision":"need_fact","fact_request":{"queries":[{"tool":"inspect_path","path":"one"},{"tool":"inspect_path","path":"two"}]}}',
      '{"decision":"allow","risk":"low","reason":"enough facts"}',
    ]
    const root = mkdtempSync(path.join(tmpdir(), 'ar-fact-clip-'))
    writeFileSync(path.join(root, 'one'), '1')
    writeFileSync(path.join(root, 'two'), '2')
    const { ctx, handler } = makeCtx((name) => {
      if (name === 'llm') return {
        stream: async function* (options: any) {
          prompts.push(options.messages[0].content[0].text)
          const text = replies.shift() ?? '{"decision":"deny","risk":"high","reason":"x"}'
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'block-end', index: 0, block: { type: 'text', text } }
          yield { type: 'finish', reason: 'stop' }
        },
      }
      if (name === 'sandboxPolicy') return { resolve: () => ({ mode: 'workspace-write', workspaceRoot: root }) }
      throw new Error('no service')
    })
    AutoReview(ctx as never, { reviewer: { factFinding: { maxRounds: 2, maxFacts: 1 } }, audit: { path: auditFile } })
    const agent = makeAgent()
    agent.session.cwd = root
    agent.session.events = [{ type: 'tool/call', data: { callId: 'facts-clip', name: 'bash', arguments: '{"command":"cat one"}' } }]
    const out = await handler()({ agent, toolName: 'bash', callId: 'facts-clip', reason: 'x' }, async () => 'DELEGATED')
    check('fact query batch is clipped to remaining budget', out, 'allowed-once')
    check('clipped fact prompt contains first observation only', prompts[1].includes('one') && !prompts[1].includes('"path": "two"'), true)
    rmSync(root, { recursive: true, force: true })
  }
}

// ---------- command/settings fallback behavior ----------
{
  const commands: Record<string, any> = {}
  const ctx = {
    logger: () => ({ warn: () => {}, error: () => {} }),
    get: (name: string) => {
      if (name === 'commands') return { register: (def: any) => { commands[def.name] = def } }
      throw new Error('no service')
    },
    on: () => {},
  }
  AutoReview(ctx as never, {})
  const noSettings = await commands['auto-review'].handler({ rawInput: 'on' })
  check('auto-review toggle without settings provider errors', noSettings.kind === 'error' && noSettings.text.includes('no settings provider'), true)
  const noDenials = await commands.approve.handler({ agent: makeAgent(), rawInput: '' })
  check('approve with no denial history errors', noDenials.kind === 'error' && noDenials.text.includes('no recent'), true)
}

{
  const commands: Record<string, any> = {}
  const settings = {
    register: (_ns: string, _schema: unknown, opts: any) => ({
      get: () => Config(opts.base ?? {}),
      update: async () => { throw new Error('disk full') },
    }),
  }
  const ctx = {
    logger: () => ({ warn: () => {}, error: () => {} }),
    get: (name: string) => {
      if (name === 'settings') return settings
      if (name === 'commands') return { register: (def: any) => { commands[def.name] = def } }
      throw new Error('no service')
    },
    on: () => {},
  }
  AutoReview(ctx as never, {})
  const failedPersist = await commands['auto-review'].handler({ rawInput: 'off' })
  check('auto-review persistence failure is surfaced', failedPersist.kind === 'error' && failedPersist.text.includes('disk full'), true)
}

report()
