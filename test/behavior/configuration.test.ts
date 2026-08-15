import { apply as AutoReview, Config, validateConfig } from '../../src/index.ts'
import { auditFile, check, makeAgent, report } from '../helpers.ts'

// Config validation
{
  const invalidTool = validateConfig(Config({ policy: { allowRules: [{}] } }) as never)
  check('empty allow-rule tool is rejected', String(invalidTool).includes('tool must be a non-empty string'), true)
}

// settings registration failure uses the valid row config.
{
  let handler: any = null
  const warnings: string[] = []
  const ctx = {
    logger: () => ({ warn: (message: unknown) => warnings.push(String(message)), error: () => {} }),
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
  check('settings registration failure uses valid row config', out, 'allowed-once')
  check('settings registration failure is logged', warnings.some((message) => message.includes('settings registration failed')), true)
}

// A settings read failure before any valid config delegates to the next answerer.
{
  let handler: any = null
  const warnings: string[] = []
  const ctx = {
    logger: () => ({ warn: (message: unknown) => warnings.push(String(message)), error: () => {} }),
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
  check('settings read failure before valid config delegates', out, 'DELEGATED')
  check('settings read failure is logged once', warnings.filter((message) => message.includes('settings read failed')).length, 1)
}

// A later settings read failure keeps the last known-good configuration.
{
  let handler: any = null
  let reads = 0
  const warnings: string[] = []
  const valid = Config({
    policy: { allowRules: [{ tool: 'bash', operations: ['ls'], escalationTarget: '' }] },
    audit: { path: auditFile },
  })
  const ctx = {
    logger: () => ({ warn: (message: unknown) => warnings.push(String(message)), error: () => {} }),
    get: (name: string) => {
      if (name === 'settings') return {
        register: () => ({
          get: () => {
            reads++
            if (reads === 1) return valid
            throw new Error('settings read failed')
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
  agent.session.events = [{ type: 'tool/call', data: { callId: 'last-valid', name: 'bash', arguments: '{"command":"ls"}' } }]
  const out = await handler({ agent, toolName: 'bash', callId: 'last-valid', reason: 'x' }, async () => 'DELEGATED')
  check('settings read failure keeps last known-good configuration', out, 'allowed-once')
  check('settings read failure logs warning', warnings.some((message) => message.includes('settings read failed')), true)
}

// Invalid row config does not arm auto-review.
{
  let handler: any = null
  const errors: string[] = []
  const ctx = {
    logger: () => ({ warn: () => {}, error: (message: unknown) => errors.push(String(message)) }),
    get: () => { throw new Error('no service') },
    on: (event: string, fn: unknown) => { if (event === 'approval/request') handler = fn },
  }
  AutoReview(ctx as never, { enabled: 'yes' })
  const out = await handler({ agent: makeAgent(), toolName: 'bash', reason: 'x' }, async () => 'DELEGATED')
  check('structurally invalid row config refuses to arm', out, 'DELEGATED')
  check('invalid row config parse failure is logged', errors.some((message) => message.includes('refusing to arm')), true)
}

// /auto-review persistence uses the settings service.
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
  const out = await commands['auto-review'].handler({ rawInput: 'on' })
  check('auto-review toggle without settings provider errors', out.kind === 'error' && out.text.includes('no settings provider'), true)
}

{
  const commands: Record<string, any> = {}
  const settings = {
    register: (_namespace: string, _schema: unknown, options: any) => ({
      get: () => Config(options.base ?? {}),
      update: async () => { throw new Error('disk full') },
    }),
  }
  const ctx = {
    logger: () => ({ warn: () => {}, error: () => {} }),
    get: (name: string) => {
      if (name === 'settings') return settings
      if (name === 'commands') return { register: (definition: any) => { commands[definition.name] = definition } }
      throw new Error('no service')
    },
    on: () => {},
  }
  AutoReview(ctx as never, {})
  const out = await commands['auto-review'].handler({ rawInput: 'off' })
  check('auto-review persistence failure is surfaced', out.kind === 'error' && out.text.includes('disk full'), true)
}

report()
