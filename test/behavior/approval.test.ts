import { apply as AutoReview, matchAllowRule } from '../../src/index.ts'
import { auditFile, check, makeAgent, report } from '../helpers.ts'

// allowRules matching
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

// approval/request routing before reviewer execution
function makeContext(getService: (name: string) => unknown) {
  let handler: any = null
  const ctx = {
    logger: () => ({ warn: () => {}, error: () => {} }),
    get: getService,
    on: (event: string, fn: unknown) => { if (event === 'approval/request') handler = fn },
  }
  return { ctx, handler: () => handler }
}

{
  const { ctx, handler } = makeContext(() => { throw new Error('no service') })
  AutoReview(ctx as never, { policy: { tools: ['write_file'] }, audit: { path: auditFile } })
  const agent = makeAgent()
  agent.session.events = [{ type: 'tool/call', data: { callId: 'filter-1', name: 'bash', arguments: '{"command":"ls"}' } }]
  const out = await handler()({ agent, toolName: 'bash', callId: 'filter-1', reason: 'x' }, async () => 'DELEGATED')
  check('tool filter delegates excluded approval asks', out, 'DELEGATED')
}

{
  const { ctx, handler } = makeContext(() => { throw new Error('no service') })
  AutoReview(ctx as never, { audit: { path: auditFile } })
  const agent = makeAgent()
  agent.session.events = [{ type: 'tool/call', data: { callId: 'abort-1', name: 'bash', arguments: '{"command":"ls"}' } }]
  const controller = new AbortController()
  controller.abort()
  const out = await handler()({ agent, toolName: 'bash', callId: 'abort-1', reason: 'x', signal: controller.signal }, async () => 'DELEGATED')
  check('already-aborted approval returns cancelled', out, 'cancelled')
}

{
  const { ctx, handler } = makeContext(() => { throw new Error('reviewer must not run') })
  AutoReview(ctx as never, { policy: { maxInputChars: 20 }, audit: { enabled: false } })
  const agent = makeAgent()
  agent.session.events = [{ type: 'tool/call', data: { callId: 'oversized-input', name: 'bash', arguments: '{"command":"echo a command longer than the configured input limit"}' } }]
  const out = await handler()({ agent, toolName: 'bash', callId: 'oversized-input', reason: 'x' }, async () => 'DELEGATED')
  check('maxInputChars rejects oversized pending request without reviewer', out, 'rejected')
}

// /approve without a denial record
{
  const commands: Record<string, any> = {}
  const ctx = {
    logger: () => ({ warn: () => {}, error: () => {} }),
    get: (name: string) => {
      if (name === 'commands') return { register: (definition: any) => { commands[definition.name] = definition } }
      throw new Error('no service')
    },
    on: () => {},
  }
  AutoReview(ctx as never, {})
  const out = await commands.approve.handler({ agent: makeAgent(), rawInput: '' })
  check('approve with no denial history errors', out.kind === 'error' && out.text.includes('no recent'), true)
}

report()
