import { spawn } from 'node:child_process'
import { REQUIRED_BEHAVIORS } from './behavior/contract.ts'

const suites = [
  'test/units.test.ts',
  'test/behavior/approval.test.ts',
  'test/behavior/reviewer.test.ts',
  'test/behavior/fact-finding.test.ts',
  'test/behavior/breaker.test.ts',
  'test/behavior/audit.test.ts',
  'test/behavior/configuration.test.ts',
  'test/pipeline.test.ts',
  'test/policy-cases.test.ts',
]

const observed = new Set<string>()

function observe(line: string): void {
  const match = /^ok   (.+)$/.exec(line.trimEnd())
  if (match) observed.add(match[1])
}

async function runSuite(suite: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', suite], {
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    })

    let stdoutTail = ''
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      process.stdout.write(text)
      const lines = (stdoutTail + text).split(/\r?\n/)
      stdoutTail = lines.pop() ?? ''
      for (const line of lines) observe(line)
    })
    child.stderr.pipe(process.stderr)

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (stdoutTail) observe(stdoutTail)
      if (code === 0) resolve()
      else reject(new Error(`${suite} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`))
    })
  })
}

for (const suite of suites) await runSuite(suite)

const missing = REQUIRED_BEHAVIORS.filter((item) => !observed.has(item.check))
if (missing.length > 0) {
  console.error('\nREQUIRED BEHAVIOR CONTRACT FAILED')
  for (const item of missing) {
    console.error(`  ${item.id} -> missing passing check: ${item.check}`)
    console.error(`    ${item.requirement}`)
  }
  process.exit(1)
}

console.log(`\nREQUIRED BEHAVIOR CONTRACT PASSED (${REQUIRED_BEHAVIORS.length}/${REQUIRED_BEHAVIORS.length})`)
