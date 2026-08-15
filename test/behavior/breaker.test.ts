import { apply as AutoReview, Breaker, Config, currentTurn } from '../../src/index.ts'
import { check, makeAgent, report } from '../helpers.ts'

// Circuit-breaker state
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

// The rolling window counts approval outcomes, including non-denials.
{
  const breaker = new Breaker()
  const cfg = Config({ breaker: { consecutiveDenyLimit: 99, windowSize: 50, windowDenyLimit: 10 } })
  for (let i = 0; i < 9; i++) {
    breaker.note('window-agent', 'deny', cfg, [])
    breaker.note('window-agent', 'allow', cfg, [])
  }
  check('breaker window stays below limit after nine denials', breaker.reason('window-agent', cfg), null)
  breaker.note('window-agent', 'deny', cfg, [])
  check('breaker window counts approval outcomes', String(breaker.reason('window-agent', cfg)).includes('approval outcomes'), true)
}

function reviewerStream(queue: string[]) {
  return async function* () {
    const text = queue.shift() ?? '{"decision":"deny","risk":"medium","reason":"default deny"}'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: 'stop' }
  }
}

async function driveDenials(action: 'cancel' | 'inject' | 'off', options?: { injectThrows?: boolean; cancelThrows?: boolean }) {
  let handler: any = null
  const warnings: string[] = []
  const injected: unknown[] = []
  const cancelled: unknown[] = []
  const queue = Array(3).fill('{"decision":"deny","risk":"medium","reason":"not authorized"}')
  const ctx = {
    logger: () => ({ warn: (message: unknown) => warnings.push(String(message)), error: () => {} }),
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

// breaker.action
{
  const result = await driveDenials('off')
  check('breaker off performs no trip action', result.injected.length === 0 && result.cancelled.length === 0, true)
}

{
  const result = await driveDenials('inject')
  check('breaker inject action explains without cancelling', result.injected.length === 1 && result.cancelled.length === 0, true)
}

// Failures from agent.inject or agent.cancel stay inside the approval answerer.
{
  const result = await driveDenials('cancel', { injectThrows: true, cancelThrows: true })
  check('breaker callback failures never escape answerer', result.cancelled.length, 0)
  check('breaker inject failure is logged', result.warnings.some((message) => message.includes('inject failed')), true)
  check('breaker cancel failure is logged', result.warnings.some((message) => message.includes('cancel failed')), true)
}

report()
