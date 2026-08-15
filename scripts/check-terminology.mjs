import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const terminologyPath = path.join(root, 'docs', 'terminology.yaml')

function parseScalar(raw) {
  const value = raw.trim()
  if (value.startsWith('"')) return JSON.parse(value)
  if (value.startsWith("'")) return value.slice(1, -1).replaceAll("''", "'")
  return value.replace(/\s+#.*$/, '').trim()
}

function readForbiddenTerms() {
  const lines = readFileSync(terminologyPath, 'utf8').split(/\r?\n/)
  const terms = []
  let inForbidden = false

  for (const line of lines) {
    if (/^forbidden:\s*$/.test(line)) {
      inForbidden = true
      continue
    }
    if (!inForbidden) continue
    if (/^\S/.test(line)) break
    if (/^\s*(?:#.*)?$/.test(line)) continue

    const match = line.match(/^\s{2}-\s+(.+?)\s*$/)
    if (!match) throw new Error(`invalid forbidden entry: ${line}`)
    const term = parseScalar(match[1])
    if (!term) throw new Error('forbidden entries must not be empty')
    terms.push(term)
  }

  if (terms.length === 0) throw new Error('docs/terminology.yaml has no forbidden entries')
  const duplicates = terms.filter((term, index) => terms.indexOf(term) !== index)
  if (duplicates.length) throw new Error(`duplicate forbidden entries: ${[...new Set(duplicates)].join(', ')}`)
  return terms
}

function walk(relativeDir, extensions) {
  const start = path.join(root, relativeDir)
  const files = []

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (extensions.has(path.extname(entry.name))) files.push(path.relative(root, full))
    }
  }

  visit(start)
  return files
}

const files = [
  'README.md',
  'README.zh.md',
  ...walk('docs', new Set(['.md'])),
  ...walk('src', new Set(['.ts'])),
  ...walk('test', new Set(['.ts'])),
  ...walk(path.join('.github', 'workflows'), new Set(['.yml', '.yaml'])),
].sort()

const forbidden = readForbiddenTerms()
const failures = []

for (const file of files) {
  const lines = readFileSync(path.join(root, file), 'utf8').split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const foldedLine = lines[index].toLowerCase()
    for (const term of forbidden) {
      if (foldedLine.includes(term.toLowerCase())) {
        failures.push(`${file}:${index + 1}: forbidden terminology ${JSON.stringify(term)}`)
      }
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`terminology check passed (${files.length} files, ${forbidden.length} forbidden phrases)`)
