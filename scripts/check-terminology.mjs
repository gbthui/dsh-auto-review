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

function readTerminology() {
  const lines = readFileSync(terminologyPath, 'utf8').split(/\r?\n/)
  const terms = new Map()
  const forbiddenZh = []
  const forbiddenEn = []
  let section = null
  let currentTerm = null
  let inAvoidZh = false

  for (const line of lines) {
    if (/^terms:\s*$/.test(line)) {
      section = 'terms'
      currentTerm = null
      inAvoidZh = false
      continue
    }
    if (/^forbidden_zh:\s*$/.test(line)) {
      section = 'forbidden_zh'
      currentTerm = null
      inAvoidZh = false
      continue
    }
    if (/^forbidden_en:\s*$/.test(line)) {
      section = 'forbidden_en'
      currentTerm = null
      inAvoidZh = false
      continue
    }

    if (section === 'terms') {
      const termStart = line.match(/^  ([a-z0-9-]+):\s*$/)
      if (termStart) {
        currentTerm = { id: termStart[1], zh: '', avoidZh: [] }
        terms.set(currentTerm.id, currentTerm)
        inAvoidZh = false
        continue
      }
      if (!currentTerm) continue

      const zh = line.match(/^    zh:\s+(.+?)\s*$/)
      if (zh) {
        currentTerm.zh = parseScalar(zh[1])
        inAvoidZh = false
        continue
      }
      if (/^    avoid_zh:\s*$/.test(line)) {
        inAvoidZh = true
        continue
      }
      if (inAvoidZh) {
        const item = line.match(/^      -\s+(.+?)\s*$/)
        if (item) {
          currentTerm.avoidZh.push(parseScalar(item[1]))
          continue
        }
        if (/^\s*(?:#.*)?$/.test(line)) continue
        inAvoidZh = false
      }
      continue
    }

    if (section === 'forbidden_zh' || section === 'forbidden_en') {
      const item = line.match(/^  -\s+(.+?)\s*$/)
      if (!item) continue
      const value = parseScalar(item[1])
      ;(section === 'forbidden_zh' ? forbiddenZh : forbiddenEn).push(value)
    }
  }

  for (const term of terms.values()) {
    if (!term.zh) throw new Error(`terminology entry ${term.id} has no zh value`)
  }
  if (forbiddenZh.length === 0 || forbiddenEn.length === 0) {
    throw new Error('docs/terminology.yaml must define forbidden_zh and forbidden_en')
  }

  return { terms: [...terms.values()], forbiddenZh, forbiddenEn }
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

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
}

const { terms, forbiddenZh, forbiddenEn } = readTerminology()
const files = [
  'README.md',
  'README.zh.md',
  'package.json',
  'cordis.patch.yml',
  ...walk('docs', new Set(['.md'])),
  ...walk('src', new Set(['.ts'])),
  ...walk('test', new Set(['.ts'])),
  ...walk(path.join('.github', 'workflows'), new Set(['.yml', '.yaml'])),
].sort()

const failures = []

for (const file of files) {
  const raw = readFileSync(path.join(root, file), 'utf8')
  const markdown = file.endsWith('.md')
  const text = markdown ? stripMarkdown(raw) : raw
  const lines = text.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const foldedLine = line.toLowerCase()

    for (const term of [...forbiddenZh, ...forbiddenEn]) {
      if (foldedLine.includes(term.toLowerCase())) {
        failures.push(`${file}:${index + 1}: forbidden terminology ${JSON.stringify(term)}`)
      }
    }
  }
}

const chineseDocs = [
  'README.zh.md',
  ...walk('docs', new Set(['.md'])).filter((file) => file.endsWith('.zh.md')),
]

for (const file of chineseDocs) {
  const text = stripMarkdown(readFileSync(path.join(root, file), 'utf8'))
  const lines = text.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const foldedLine = lines[index].toLowerCase()
    for (const term of terms) {
      for (const avoided of term.avoidZh) {
        if (foldedLine.includes(avoided.toLowerCase())) {
          failures.push(`${file}:${index + 1}: use ${JSON.stringify(term.zh)} instead of ${JSON.stringify(avoided)}`)
        }
      }
    }
  }
}

if (failures.length) {
  console.error([...new Set(failures)].join('\n'))
  process.exit(1)
}

const preferredCount = terms.reduce((count, term) => count + term.avoidZh.length, 0)
console.log(`terminology check passed (${files.length} files, ${preferredCount} Chinese alternatives, ${forbiddenZh.length + forbiddenEn.length} forbidden phrases)`)
