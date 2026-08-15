import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply as AutoReview, executeFacts, sanitizeGitUrl } from '../../src/index.ts'
import { check, makeAgent, report } from '../helpers.ts'

// Read-only fact tools
{
  const root = mkdtempSync(path.join(tmpdir(), 'ar-fact-finding-'))
  const file = path.join(root, 'plain.txt')
  const dir = path.join(root, 'dir')
  const subdir = path.join(dir, 'sub')
  writeFileSync(file, 'hello')
  mkdirSync(subdir, { recursive: true })

  const observations = await executeFacts([
    { tool: 'inspect_directory', path: 'plain.txt' },
    { tool: 'inspect_directory', path: 'dir' },
    { tool: 'inspect_file_metadata', path: 'plain.txt' },
    { tool: 'inspect_text_file', path: 'dir' },
  ], root, { contentEnabled: true, contentMaxBytes: 4096 })
  check('directory fact rejects regular file', String(observations[0].result.error).includes('not a directory'), true)
  check('directory fact reports entry and subdir counts', observations[1].result.entryCount === 1 && observations[1].result.subdirCount === 1, true)
  check('file metadata reports byte size', observations[2].result.kind === 'file' && observations[2].result.size === 5, true)
  check('content fact rejects directory', String(observations[3].result.error).includes('not a regular file'), true)

  const malformedRemote = sanitizeGitUrl('//user:secret@example.invalid')
  check('git URL fallback redacts credentials', JSON.stringify(malformedRemote).includes('<redacted>'), true)

  if (process.platform !== 'win32') {
    const bin = mkdtempSync(path.join(tmpdir(), 'ar-git-failure-'))
    const fakeGit = path.join(bin, 'git')
    writeFileSync(fakeGit, '#!/bin/sh\nexit 7\n')
    chmodSync(fakeGit, 0o755)
    const oldPath = process.env.PATH
    process.env.PATH = bin + path.delimiter + (oldPath ?? '')
    try {
      const failed = await executeFacts([
        { tool: 'inspect_git_remote', remote: 'origin' },
        { tool: 'inspect_git_status' },
      ], root)
      check('git remote fact returns bounded error observation', typeof failed[0].result.error === 'string', true)
      check('git status fact returns bounded error observation', typeof failed[1].result.error === 'string', true)
    } finally {
      process.env.PATH = oldPath
      rmSync(bin, { recursive: true, force: true })
    }
  }
  rmSync(root, { recursive: true, force: true })
}

function makeContext(getService: (name: string) => unknown) {
  let handler: any = null
  const ctx = {
    logger: () => ({ warn: () => {}, error: () => {} }),
    get: getService,
    on: (event: string, fn: unknown) => { if (event === 'approval/request') handler = fn },
  }
  return { ctx, handler: () => handler }
}

// factFinding.enabled
{
  const replies = ['{"decision":"need_fact","fact_request":{"queries":[{"tool":"inspect_path","path":"x"}]}}']
  const { ctx, handler } = makeContext((name) => {
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
  AutoReview(ctx as never, { reviewer: { factFinding: { enabled: false } }, audit: { enabled: false } })
  const agent = makeAgent()
  agent.session.events = [{ type: 'tool/call', data: { callId: 'facts-off', name: 'bash', arguments: '{"command":"ls"}' } }]
  const out = await handler()({ agent, toolName: 'bash', callId: 'facts-off', reason: 'x' }, async () => 'DELEGATED')
  check('fact request with fact finding disabled fails closed', out, 'unavailable')
}

// maxFacts applies before fact execution
{
  const prompts: string[] = []
  const replies = [
    '{"decision":"need_fact","fact_request":{"queries":[{"tool":"inspect_path","path":"one"},{"tool":"inspect_path","path":"two"}]}}',
    '{"decision":"allow","risk":"low","reason":"enough facts"}',
  ]
  const root = mkdtempSync(path.join(tmpdir(), 'ar-fact-budget-'))
  writeFileSync(path.join(root, 'one'), '1')
  writeFileSync(path.join(root, 'two'), '2')
  const { ctx, handler } = makeContext((name) => {
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
  AutoReview(ctx as never, { reviewer: { factFinding: { maxRounds: 2, maxFacts: 1 } }, audit: { enabled: false } })
  const agent = makeAgent()
  agent.session.cwd = root
  agent.session.events = [{ type: 'tool/call', data: { callId: 'facts-clip', name: 'bash', arguments: '{"command":"cat one"}' } }]
  const out = await handler()({ agent, toolName: 'bash', callId: 'facts-clip', reason: 'x' }, async () => 'DELEGATED')
  check('fact query batch is clipped to remaining budget', out, 'allowed-once')
  check('clipped fact prompt contains first observation only', prompts[1].includes('one') && !prompts[1].includes('"path": "two"'), true)
  rmSync(root, { recursive: true, force: true })
}

// sandboxPolicy metadata is optional
{
  let prompt = ''
  const { ctx, handler } = makeContext((name) => {
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
    throw new Error('no service')
  })
  AutoReview(ctx as never, { audit: { enabled: false } })
  const agent = makeAgent()
  agent.session.cwd = '/workspace/session-fallback'
  agent.session.events = [{ type: 'tool/call', data: { callId: 'sandbox-fail', name: 'bash', arguments: '{"command":"ls"}' } }]
  const out = await handler()({ agent, toolName: 'bash', callId: 'sandbox-fail', reason: 'x' }, async () => 'DELEGATED')
  check('sandbox policy failure falls back to session cwd', out, 'allowed-once')
  check('sandbox fallback workspace reaches reviewer', prompt.includes('/workspace/session-fallback'), true)
}

report()
