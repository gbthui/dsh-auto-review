import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
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
check('resolveApiKey trims direct value', await resolveApiKey({ apiKey: '  direct-key  ' }), 'direct-key')
const keyDir = mkdtempSync(path.join(tmpdir(), 'ar-reviewer-key-'))
const emptyKeyFile = path.join(keyDir, 'empty.env')
writeFileSync(emptyKeyFile, '# comment only' + NL + 'not-an-assignment' + NL)
check('resolveApiKey empty env falls through to empty file then null', await resolveApiKey({ apiKeyEnv: 'AR_TEST_EMPTY_REVIEWER_KEY', apiKeyFile: emptyKeyFile }), null)
check('resolveApiKey missing file falls through to null', await resolveApiKey({ apiKeyFile: path.join(keyDir, 'missing.env') }), null)
delete process.env.AR_TEST_EMPTY_REVIEWER_KEY
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

report()
