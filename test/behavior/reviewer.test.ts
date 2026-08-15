import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  apply as AutoReview,
  callReviewer,
  parseReviewerReply,
  parseVerdict,
  resolveApiKey,
  reviewWithSessionModel,
} from '../../src/index.ts'
import { check, makeAgent, NL, report } from '../helpers.ts'

// Reviewer reply parsing
check('verdict non-string reason normalizes empty', parseVerdict('{"decision":"allow","risk":"low","reason":12}').reason, '')
const gitOrigin = parseReviewerReply('{"decision":"need_fact","fact_request":{"queries":[{"tool":"inspect_git_remote"}]}}')
check('fact parser defaults git remote to origin', gitOrigin.kind === 'fact-request' ? gitOrigin.queries[0] : null, { tool: 'inspect_git_remote', remote: 'origin' })
const gitNamed = parseReviewerReply('{"decision":"need_fact","fact_request":{"queries":[{"tool":"inspect_git_remote","remote":"upstream"},{"tool":"inspect_git_status"}]}}')
check('fact parser preserves named git remote', gitNamed.kind === 'fact-request' ? gitNamed.queries[0] : null, { tool: 'inspect_git_remote', remote: 'upstream' })
check('fact parser accepts git status without path', gitNamed.kind === 'fact-request' ? gitNamed.queries[1] : null, { tool: 'inspect_git_status' })
let threw = false
try { parseReviewerReply('{"decision":"need_fact","fact_request":{"queries":[{"tool":"inspect_path"}]}}') } catch { threw = true }
check('fact parser rejects missing metadata path', threw, true)

// Reviewer API key resolution
process.env.AR_TEST_EMPTY_REVIEWER_KEY = '   '
process.env.AR_TEST_REVIEWER_KEY = 'env-key'
check('resolveApiKey trims direct value', await resolveApiKey({ apiKey: '  direct-key  ' }), 'direct-key')
const keyDir = mkdtempSync(path.join(tmpdir(), 'ar-reviewer-key-'))
const emptyKeyFile = path.join(keyDir, 'empty.env')
const priorityKeyFile = path.join(keyDir, 'priority.env')
writeFileSync(emptyKeyFile, '# comment only' + NL + 'not-an-assignment' + NL)
writeFileSync(priorityKeyFile, 'REVIEWER_KEY=file-key' + NL)
check(
  'resolveApiKey uses apiKey before apiKeyEnv and apiKeyFile',
  await resolveApiKey({ apiKey: 'direct-key', apiKeyEnv: 'AR_TEST_REVIEWER_KEY', apiKeyFile: priorityKeyFile }),
  'direct-key',
)
check(
  'resolveApiKey uses apiKeyEnv before apiKeyFile',
  await resolveApiKey({ apiKeyEnv: 'AR_TEST_REVIEWER_KEY', apiKeyFile: priorityKeyFile }),
  'env-key',
)
check('resolveApiKey empty env falls through to empty file then null', await resolveApiKey({ apiKeyEnv: 'AR_TEST_EMPTY_REVIEWER_KEY', apiKeyFile: emptyKeyFile }), null)
check('resolveApiKey missing file falls through to null', await resolveApiKey({ apiKeyFile: path.join(keyDir, 'missing.env') }), null)
delete process.env.AR_TEST_EMPTY_REVIEWER_KEY
delete process.env.AR_TEST_REVIEWER_KEY
rmSync(keyDir, { recursive: true, force: true })

// Explicit reviewer endpoint
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

// Session-model reviewer
{
  let errorText = ''
  try {
    await reviewWithSessionModel({ get: () => undefined }, makeAgent(), {}, { system: 's', user: 'u' })
  } catch (error) { errorText = String((error as Error).message) }
  check('session reviewer without llm service fails closed', errorText.includes('no llm service'), true)

  errorText = ''
  try {
    await reviewWithSessionModel({ get: () => ({ stream: async function* () {} }) }, undefined, {}, { system: 's', user: 'u' })
  } catch (error) { errorText = String((error as Error).message) }
  check('session reviewer without provider-model fails closed', errorText.includes('no provider/model'), true)
}

// A second malformed reply follows denyOnReviewerError.
{
  let handler: any = null
  let calls = 0
  const ctx = {
    logger: () => ({ warn: () => {}, error: () => {} }),
    get: (name: string) => {
      if (name === 'llm') return {
        stream: async function* () {
          calls++
          const text = 'not-json'
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
  AutoReview(ctx as never, { policy: { denyOnReviewerError: false }, audit: { enabled: false } })
  const agent = makeAgent()
  agent.session.events = [{ type: 'tool/call', data: { callId: 'malformed-delegate', name: 'bash', arguments: '{"command":"ls"}' } }]
  const out = await handler({ agent, toolName: 'bash', callId: 'malformed-delegate', reason: 'x' }, async () => 'DELEGATED')
  check('double-malformed delegates when denyOnReviewerError is false', out, 'DELEGATED')
  check('double-malformed delegation retries once', calls, 2)
}

// Cancellation during reviewer execution
{
  let handler: any = null
  const controller = new AbortController()
  const ctx = {
    logger: () => ({ warn: () => {}, error: () => {} }),
    get: (name: string) => {
      if (name === 'llm') return {
        stream: async function* () {
          controller.abort()
          throw new Error('mock reviewer transport failed')
        },
      }
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

report()
