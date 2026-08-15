/**
 * Reviewer policy test corpus: adversarial evidence/request cases with
 * expected verdicts, runnable against a real endpoint when configured.
 *
 *   AR_REVIEWER_BASE_URL  AR_REVIEWER_MODEL  AR_REVIEWER_API_KEY
 *
 * Without the env vars the script prints the skip notice (exit 0).
 * For N-round confusion-matrix measurement, see test/policy-matrix.test.ts.
 */
import { reviewOnceWithParseRetry, callReviewer, buildPrompt, DEFAULT_REVIEWER_POLICY } from '../src/index.ts'
import { cases } from './policy-corpus.ts'

const baseURL = process.env.AR_REVIEWER_BASE_URL ?? ''
const model = process.env.AR_REVIEWER_MODEL ?? ''
const apiKey = process.env.AR_REVIEWER_API_KEY ?? ''
if (!baseURL || !model || !apiKey) {
  console.log('policy cases skipped: set AR_REVIEWER_BASE_URL / AR_REVIEWER_MODEL / AR_REVIEWER_API_KEY to run against a live endpoint')
  process.exit(0)
}

const reviewer = {
  baseURL,
  model,
  apiKey,
  apiKeyEnv: '',
  apiKeyFile: '',
  timeoutMs: 60000,
  maxTokens: 1024,
  thinking: 'off' as const,
}
const TEST_WORKSPACE = '/workspace/project'
let passed = 0
let failed = 0
for (const testCase of cases) {
  const prompt = buildPrompt(
    testCase.request,
    testCase.toolCall,
    { workspaceRoot: TEST_WORKSPACE, sandboxMode: 'workspace-write' },
    testCase.evidence,
    testCase.override ?? null,
  )
  try {
    // Same path the production answerer takes: strict parse + one
    // corrective retry for unparseable replies, then fail closed.
    const reply = await reviewOnceWithParseRetry(
      (system) => callReviewer(reviewer, { system, user: prompt.user }),
      DEFAULT_REVIEWER_POLICY,
    )
    if (reply.kind !== 'verdict') throw new Error('reviewer requested facts in the corpus (unexpected)')
    const verdict = reply.verdict
    const ok = verdict.decision === testCase.expect
    if (ok) passed++
    else failed++
    console.log((ok ? 'ok   ' : 'FAIL ') + testCase.label + ' -> ' + verdict.decision + ' (' + verdict.risk + ') expected ' + testCase.expect)
    if (!ok) console.log('      reason: ' + verdict.reason)
  } catch (error) {
    failed++
    console.log('FAIL ' + testCase.label + ' -> ERROR: ' + String((error as Error)?.message ?? error).slice(0, 160))
  }
}
console.log(failed === 0 ? 'POLICY CASES PASSED (' + passed + '/' + cases.length + ')' : failed + '/' + cases.length + ' POLICY CASES FAILED')
process.exit(failed === 0 ? 0 : 1)
